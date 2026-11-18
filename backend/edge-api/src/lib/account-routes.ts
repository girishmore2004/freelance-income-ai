import type { Env } from "../types";
import { authenticateRequest } from "./auth-context";
import type { AuthenticatedSession } from "./session-service";
import { createAccessSession } from "./session-service";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { hashPassword, verifyPassword } from "./password-service";
import {
  consumeAccountActionTokenWith,
  isPlausibleActionToken,
  issueAccountActionTokenWith,
  secondsSinceLastToken
} from "./account-token-store";
import { accountMailConfigured, publicAppUrl, sendAccountEmail } from "./account-mailer";
import {
  decryptTotpSecret,
  decryptWithRing,
  encryptTotpSecret,
  generateRecoveryCodes,
  mfaKeyRing,
  generateTotpSecret,
  matchingTotpStep,
  provisioningUri,
  recoveryCodeHash
} from "./mfa";

/**
 * Account-security routes ported from the Python service (main.py) so the
 * Edge API has auth parity (Progress Report finding 5). Request fields,
 * validation limits, status codes and messages match the FastAPI routes.
 *
 *   POST   /api/v1/auth/verify-email                {token}
 *   POST   /api/v1/auth/resend-verification         {email}
 *   POST   /api/v1/auth/password-reset/request      {email}
 *   POST   /api/v1/auth/password-reset/confirm      {token, new_password}
 *   POST   /api/v1/auth/password/change             {current_password, new_password}
 *   GET    /api/v1/auth/sessions
 *   DELETE /api/v1/auth/sessions/{id}
 *   GET    /api/v1/auth/mfa/status
 *   POST   /api/v1/auth/mfa/setup                   {password}
 *   POST   /api/v1/auth/mfa/enable                  {code}
 *   POST   /api/v1/auth/mfa/disable                 {password, code}
 *   POST   /api/v1/auth/mfa/recovery-codes/rotate   {password, code}
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;
const INVALID_VERIFY = "Verification link is invalid, expired or already used.";
const INVALID_RESET = "Password reset link is invalid, expired or already used.";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function validEmail(value: unknown): string | null {
  const email = str(value).trim().toLowerCase();
  return email.length >= 5 && email.length <= 255 && EMAIL_RE.test(email) ? email : null;
}

function validNewPassword(value: unknown): string | null {
  const password = str(value);
  return password.length >= 12 && password.length <= 128 ? password : null;
}

function mfaKey(env: Env): string | null {
  // K-04: MFA_ENCRYPTION_KEY when set, else JWT_SECRET (equal to the Python SECRET_KEY).
  return mfaKeyRing(env)[0] ?? null;
}

async function revokeAllSessions(sql: Queryable, userId: string): Promise<void> {
  await sql`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ${userId} AND revoked_at IS NULL`;
  await sql`UPDATE mfa_challenges SET used_at = NOW() WHERE user_id = ${userId} AND used_at IS NULL`;
}

/**
 * Sends an account email with a single-use token link. The token is issued in
 * its own transaction that is rolled back if the provider rejects the message,
 * so no usable token exists for an email that was never delivered.
 */
async function sendTokenEmail(
  env: Env,
  sql: Sql,
  userId: string,
  email: string,
  purpose: "verify_email" | "password_reset",
  send: typeof sendAccountEmail = sendAccountEmail
): Promise<void> {
  const base = publicAppUrl(env);
  await sql.begin(async (tx) => {
    const issued = await issueAccountActionTokenWith(tx, userId, purpose);
    const link = `${base}/#${purpose === "verify_email" ? "verify_token" : "reset_token"}=${issued.token}`;
    const message =
      purpose === "verify_email"
        ? {
            to: email,
            subject: "Verify your Freelance Income AI account",
            text: `Verify your email using this link (valid for 24 hours):\n\n${link}\n\nIf you did not create this account, ignore this message.`
          }
        : {
            to: email,
            subject: "Reset your Freelance Income AI password",
            text: `Use this link to reset your password (valid for 30 minutes):\n\n${link}\n\nIf you did not request this, ignore this message.`
          };
    await send(env, message);
  });
}

export interface AccountRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  sendEmail: typeof sendAccountEmail;
  issueSession: typeof createAccessSession;
}

const defaultDeps: AccountRouteDeps = {
  database,
  authenticate: authenticateRequest,
  sendEmail: sendAccountEmail,
  issueSession: createAccessSession
};

export async function handleAccountRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: AccountRouteDeps = defaultDeps
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const sessionMatch = path.match(/^\/api\/v1\/auth\/sessions\/([\w-]{1,64})$/);

  const publicRoutes = new Set([
    "POST /api/v1/auth/verify-email",
    "POST /api/v1/auth/resend-verification",
    "POST /api/v1/auth/password-reset/request",
    "POST /api/v1/auth/password-reset/confirm"
  ]);
  const privateRoutes = new Set([
    "POST /api/v1/auth/password/change",
    "GET /api/v1/auth/sessions",
    "GET /api/v1/auth/mfa/status",
    "POST /api/v1/auth/mfa/setup",
    "POST /api/v1/auth/mfa/enable",
    "POST /api/v1/auth/mfa/disable",
    "POST /api/v1/auth/mfa/recovery-codes/rotate"
  ]);
  const key = `${method} ${path}`;
  const isSessionDelete = method === "DELETE" && sessionMatch !== null;
  if (!publicRoutes.has(key) && !privateRoutes.has(key) && !isSessionDelete) return null;

  if (publicRoutes.has(key)) return handlePublic(key, request, env, requestId, deps);

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  return handlePrivate(key, sessionMatch?.[1] ?? null, request, env, requestId, auth, deps);
}

async function handlePublic(key: string, request: Request, env: Env, requestId: string, deps: AccountRouteDeps): Promise<Response> {
  const payload = (await body(request)) ?? {};
  const sql = deps.database(env);
  try {
    if (key === "POST /api/v1/auth/verify-email") {
      const token = payload.token;
      if (!isPlausibleActionToken(token)) return failure("INVALID_TOKEN", INVALID_VERIFY, 400, requestId);
      const verified = await sql.begin(async (tx) => {
        const action = await consumeAccountActionTokenWith(tx, token, "verify_email");
        if (!action) return false;
        const rows = await tx`UPDATE users SET email_verified = true WHERE id = ${action.user_id} RETURNING id`;
        return rows.length > 0;
      });
      if (!verified) return failure("INVALID_TOKEN", INVALID_VERIFY, 400, requestId);
      return success({ status: "verified", message: "Email verified. You can now sign in." }, "Email verified. You can now sign in.", 200, requestId);
    }

    if (key === "POST /api/v1/auth/password-reset/confirm") {
      const token = payload.token;
      const newPassword = validNewPassword(payload.new_password);
      if (!newPassword) return failure("INVALID_PASSWORD", "New password must be 12 to 128 characters.", 422, requestId);
      if (!isPlausibleActionToken(token)) return failure("INVALID_TOKEN", INVALID_RESET, 400, requestId);
      const passwordHash = await hashPassword(newPassword);
      const reset = await sql.begin(async (tx) => {
        const action = await consumeAccountActionTokenWith(tx, token, "password_reset");
        if (!action) return false;
        const rows = await tx`
          UPDATE users SET password_hash = ${passwordHash}, failed_login_attempts = 0, locked_until = NULL
          WHERE id = ${action.user_id} RETURNING id
        `;
        if (!rows.length) return false;
        await revokeAllSessions(tx, action.user_id);
        return true;
      });
      if (!reset) return failure("INVALID_TOKEN", INVALID_RESET, 400, requestId);
      return success({ status: "password_reset", message: "Password updated. Sign in with your new password." }, "Password updated. Sign in with your new password.", 200, requestId);
    }

    // resend-verification and password-reset/request: identical responses whether
    // or not the account exists, to avoid disclosing registered addresses.
    const email = validEmail(payload.email);
    if (!email) return failure("INVALID_EMAIL", "Provide a valid email address.", 422, requestId);
    const purpose = key === "POST /api/v1/auth/resend-verification" ? "verify_email" : "password_reset";
    const neutral =
      purpose === "verify_email"
        ? "If the account needs verification, a new email will be sent."
        : "If an account exists for that address, password reset instructions will be sent.";

    if (accountMailConfigured(env)) {
      const users = await sql<{ id: string; email: string; email_verified: boolean }[]>`
        SELECT id, email, email_verified FROM users WHERE email = ${email} LIMIT 1
      `;
      const user = users[0];
      const eligible = user && (purpose === "password_reset" || !user.email_verified);
      if (eligible) {
        const age = await secondsSinceLastToken(sql, user.id, purpose);
        if (age === null || age >= RESEND_COOLDOWN_SECONDS) {
          try {
            await sendTokenEmail(env, sql, user.id, user.email, purpose, deps.sendEmail);
          } catch (error) {
            console.error(JSON.stringify({ event: "account_mail.failed", purpose, request_id: requestId, error_message: error instanceof Error ? error.message : "unknown" }));
          }
        }
      }
    } else {
      console.warn(JSON.stringify({ event: "account_mail.not_configured", purpose, request_id: requestId }));
    }
    return success({ message: neutral }, neutral, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function handlePrivate(
  key: string,
  sessionId: string | null,
  request: Request,
  env: Env,
  requestId: string,
  auth: AuthenticatedSession,
  deps: AccountRouteDeps
): Promise<Response> {
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    if (key === "GET /api/v1/auth/sessions") {
      const rows = await sql<{ id: string; token_id: string; created_at: Date; expires_at: Date; revoked_at: Date | null }[]>`
        SELECT id, token_id, created_at, expires_at, revoked_at FROM auth_sessions
        WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50
      `;
      return success(
        rows.map((row) => ({
          id: row.id,
          created_at: new Date(row.created_at).toISOString(),
          expires_at: new Date(row.expires_at).toISOString(),
          revoked: row.revoked_at !== null,
          current: row.token_id === auth.claims.jti
        })),
        "Sessions",
        200,
        requestId
      );
    }

    if (sessionId !== null) {
      const rows = await sql`
        UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE id = ${sessionId} AND user_id = ${userId} RETURNING id
      `;
      if (!rows.length) return failure("NOT_FOUND", "Session not found", 404, requestId);
      return success({ status: "revoked" }, "Session revoked", 200, requestId);
    }

    const payload = (await body(request)) ?? {};

    if (key === "POST /api/v1/auth/password/change") {
      const current = str(payload.current_password);
      const next = validNewPassword(payload.new_password);
      if (!current || current.length > 128) return failure("INVALID_INPUT", "Current password is required.", 422, requestId);
      if (!next) return failure("INVALID_PASSWORD", "New password must be 12 to 128 characters.", 422, requestId);
      const rows = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${userId}`;
      if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
        return failure("PASSWORD_INCORRECT", "Current password is incorrect.", 400, requestId);
      }
      if (current === next) return failure("PASSWORD_UNCHANGED", "New password must be different from the current password.", 400, requestId);
      const passwordHash = await hashPassword(next);
      await sql.begin(async (tx) => {
        await tx`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`;
        await revokeAllSessions(tx, userId);
      });
      const session = await deps.issueSession(env, userId);
      return success(
        { access_token: session.accessToken, token_type: session.tokenType, expires_at: session.expiresAt, message: "Password changed; other sessions were revoked." },
        "Password changed; other sessions were revoked.",
        200,
        requestId
      );
    }

    // ---------------- MFA management ----------------
    const secretKey = mfaKey(env);
    if (!secretKey) return failure("MFA_CONFIGURATION_ERROR", "MFA is not configured.", 503, requestId);

    if (key === "GET /api/v1/auth/mfa/status") {
      const rows = await sql<{ enabled: boolean; remaining: string | number }[]>`
        SELECT u.mfa_enabled AS enabled,
               (SELECT count(*) FROM mfa_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS remaining
        FROM users u WHERE u.id = ${userId}
      `;
      return success({ enabled: Boolean(rows[0]?.enabled), recovery_codes_remaining: Number(rows[0]?.remaining ?? 0) }, "MFA status", 200, requestId);
    }

    const result = await sql.begin(async (tx) => {
      // Serialise MFA mutations for this account (matches Python FOR UPDATE).
      const users = await tx<{ id: string; email: string; password_hash: string; mfa_enabled: boolean; mfa_secret_encrypted: string; mfa_last_used_step: number | null }[]>`
        SELECT id, email, password_hash, mfa_enabled, mfa_secret_encrypted, mfa_last_used_step
        FROM users WHERE id = ${userId} FOR UPDATE
      `;
      const user = users[0];
      if (!user) return failure("ACCOUNT_NOT_FOUND", "Account no longer exists.", 401, requestId);

      const verifyCode = async (code: string, allowRecovery: boolean): Promise<{ ok: boolean; step: number | null }> => {
        let secret: string;
        try {
          secret = (await decryptWithRing(user.mfa_secret_encrypted, mfaKeyRing(env), decryptTotpSecret)).secret;
        } catch {
          throw new Error("MFA_DECRYPT");
        }
        const step = await matchingTotpStep(secret, code);
        if (step !== null && (user.mfa_last_used_step === null || step > user.mfa_last_used_step)) return { ok: true, step };
        if (!allowRecovery) return { ok: false, step: null };
        const used = await tx`
          UPDATE mfa_recovery_codes SET used_at = NOW()
          WHERE id = (
            SELECT id FROM mfa_recovery_codes
            WHERE user_id = ${userId} AND code_hash = ${await recoveryCodeHash(code)} AND used_at IS NULL
            LIMIT 1 FOR UPDATE
          ) RETURNING id
        `;
        return { ok: used.length > 0, step: null };
      };

      const replaceRecoveryCodes = async (): Promise<string[]> => {
        await tx`DELETE FROM mfa_recovery_codes WHERE user_id = ${userId}`;
        const codes = generateRecoveryCodes(10);
        for (const code of codes) {
          await tx`
            INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at, used_at)
            VALUES (${crypto.randomUUID()}, ${userId}, ${await recoveryCodeHash(code)}, NOW(), NULL)
          `;
        }
        return codes;
      };

      const code = str(payload.code).trim();
      const password = str(payload.password);

      try {
        if (key === "POST /api/v1/auth/mfa/setup") {
          if (!password || password.length > 128) return failure("INVALID_INPUT", "Password is required.", 422, requestId);
          if (!(await verifyPassword(password, user.password_hash))) return failure("PASSWORD_INCORRECT", "Password is incorrect.", 400, requestId);
          if (user.mfa_enabled) return failure("MFA_ALREADY_ENABLED", "MFA is already enabled. Disable it before setting it up again.", 409, requestId);
          const secret = generateTotpSecret();
          await tx`UPDATE users SET mfa_secret_encrypted = ${await encryptTotpSecret(secret, secretKey)} WHERE id = ${userId}`;
          const codes = await replaceRecoveryCodes();
          const message = "Scan or enter the secret in your authenticator, then confirm with a current six-digit code. Save recovery codes securely; they are shown once.";
          return success({ secret, otpauth_uri: provisioningUri(secret, user.email), recovery_codes: codes, message }, message, 200, requestId);
        }

        if (key === "POST /api/v1/auth/mfa/enable") {
          if (code.length < 6 || code.length > 32) return failure("INVALID_INPUT", "Enter the six-digit code.", 422, requestId);
          if (user.mfa_enabled) return failure("MFA_ALREADY_ENABLED", "MFA is already enabled.", 409, requestId);
          if (!user.mfa_secret_encrypted) return failure("MFA_SETUP_REQUIRED", "Start MFA setup first.", 400, requestId);
          const check = await verifyCode(code, false);
          if (!check.ok || check.step === null) return failure("MFA_CODE_INVALID", "Authenticator code is invalid or already used.", 400, requestId);
          await tx`UPDATE users SET mfa_enabled = true, mfa_last_used_step = ${check.step} WHERE id = ${userId}`;
          await tx`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ${userId} AND revoked_at IS NULL`;
          const message = "MFA enabled. All existing sessions were revoked; sign in again using your authenticator.";
          return success({ status: "enabled", message }, message, 200, requestId);
        }

        if (key === "POST /api/v1/auth/mfa/disable" || key === "POST /api/v1/auth/mfa/recovery-codes/rotate") {
          if (!password || password.length > 128 || code.length < 6 || code.length > 32) {
            return failure("INVALID_INPUT", "Password and an authenticator or recovery code are required.", 422, requestId);
          }
          if (!user.mfa_enabled) return failure("MFA_NOT_ENABLED", "MFA is not enabled.", 409, requestId);
          if (!(await verifyPassword(password, user.password_hash))) return failure("PASSWORD_INCORRECT", "Password is incorrect.", 400, requestId);
          const check = await verifyCode(code, true);
          if (!check.ok) return failure("MFA_CODE_INVALID", "Authenticator or recovery code is invalid.", 400, requestId);
          if (check.step !== null) await tx`UPDATE users SET mfa_last_used_step = ${check.step} WHERE id = ${userId}`;

          if (key === "POST /api/v1/auth/mfa/recovery-codes/rotate") {
            const codes = await replaceRecoveryCodes();
            const message = "Recovery codes replaced. All previous recovery codes are now invalid; save these new codes securely.";
            return success({ recovery_codes: codes, message }, message, 200, requestId);
          }

          await tx`UPDATE users SET mfa_enabled = false, mfa_secret_encrypted = '' WHERE id = ${userId}`;
          await tx`DELETE FROM mfa_recovery_codes WHERE user_id = ${userId}`;
          await revokeAllSessions(tx, userId);
          const message = "MFA disabled and all sessions revoked. Sign in again.";
          return success({ status: "disabled", message }, message, 200, requestId);
        }
      } catch (error) {
        if (error instanceof Error && error.message === "MFA_DECRYPT") {
          return failure("MFA_CONFIGURATION_ERROR", "MFA configuration cannot be decrypted. Contact the administrator.", 503, requestId);
        }
        throw error;
      }
      return failure("NOT_FOUND", "Authentication endpoint not found", 404, requestId);
    });
    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
