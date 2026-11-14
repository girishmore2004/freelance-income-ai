
import postgres from "postgres";
import type { Env } from "../types";
import { verifyPassword } from "./password-service";
import { createAccessSession } from "./session-service";
import { failure, success } from "./response";

interface LoginInput {
  email: string;
  password: string;
}

interface LoginUserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

type LoginOutcome =
  | { kind: "invalid" }
  | { kind: "locked" }
  | { kind: "unverified" }
  | {
      kind: "mfa";
      challengeToken: string;
      expiresIn: number;
    }
  | { kind: "authenticated"; userId: string };

function database(env: Env) {
  const connectionString = env.HYPERDRIVE?.connectionString;

  if (!connectionString) {
    throw new Error("Hyperdrive database connection is not configured.");
  }

  return postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: {
      application_name: "Freelance Income AI Edge API - Login"
    }
  });
}

function positiveSetting(
  raw: string | undefined,
  fallback: number,
  maximum: number
): number {
  if (!raw?.trim()) return fallback;

  const value = Number(raw);

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error("Invalid authentication configuration.");
  }

  return value;
}

function validateInput(
  value: unknown
): LoginInput | null {
  if (!value || typeof value !== "object") return null;

  const input = value as Record<string, unknown>;

  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string"
  ) {
    return null;
  }

  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (
    email.length < 3 ||
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 10 ||
    password.length > 128
  ) {
    return null;
  }

  return { email, password };
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createMfaChallengeJwt(
  env: Env,
  userId: string,
  challengeId: string,
  expiresAt: Date
): Promise<string> {
  const secret = env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const expires = Math.floor(expiresAt.getTime() / 1000);

  const header = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  );

  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      jti: challengeId,
      scope: "mfa_challenge",
      iat: now,
      exp: expires
    })
  );

  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  let binary = "";
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }

  const encodedSignature = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${signingInput}.${encodedSignature}`;
}

async function performLogin(
  env: Env,
  input: LoginInput
): Promise<LoginOutcome> {
  const limit = positiveSetting(
    env.LOGIN_FAILURE_LIMIT,
    5,
    100
  );

  const lockoutMinutes = positiveSetting(
    env.LOGIN_LOCKOUT_MINUTES,
    15,
    1440
  );

  const mfaMinutes = positiveSetting(
    env.MFA_CHALLENGE_MINUTES,
    5,
    60
  );

  const sql = database(env);

  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<LoginUserRow[]>`
        SELECT
          id,
          email,
          password_hash,
          email_verified,
          mfa_enabled,
          failed_login_attempts,
          locked_until
        FROM users
        WHERE email = ${input.email}
        FOR UPDATE
      `;

      const user = rows[0];

      if (!user) {
        return { kind: "invalid" };
      }

      const now = new Date();

      if (
        user.locked_until &&
        new Date(user.locked_until).getTime() > now.getTime()
      ) {
        return { kind: "locked" };
      }

      const passwordValid = await verifyPassword(
        input.password,
        user.password_hash
      );

      if (!passwordValid) {
        const attempts =
          Number(user.failed_login_attempts || 0) + 1;

        if (attempts >= limit) {
          await tx`
            UPDATE users
            SET
              failed_login_attempts = 0,
              locked_until = ${
                new Date(now.getTime() + lockoutMinutes * 60_000)
              }
            WHERE id = ${user.id}
          `;
        } else {
          await tx`
            UPDATE users
            SET failed_login_attempts = ${attempts}
            WHERE id = ${user.id}
          `;
        }

        return { kind: "invalid" };
      }

      if (
        env.REQUIRE_EMAIL_VERIFICATION?.toLowerCase() === "true" &&
        !user.email_verified
      ) {
        return { kind: "unverified" };
      }

      if (user.mfa_enabled) {
        const challengeId = crypto.randomUUID();
        const expiresAt = new Date(
          now.getTime() + mfaMinutes * 60_000
        );

        await tx`
          DELETE FROM mfa_challenges
          WHERE
            expires_at < NOW() - INTERVAL '7 days'
            OR used_at < NOW() - INTERVAL '7 days'
        `;

        await tx`
          INSERT INTO mfa_challenges (
            id,
            user_id,
            challenge_id,
            created_at,
            expires_at,
            used_at,
            attempts
          )
          VALUES (
            ${crypto.randomUUID()},
            ${user.id},
            ${challengeId},
            ${now},
            ${expiresAt},
            NULL,
            0
          )
        `;

        const challengeToken = await createMfaChallengeJwt(
          env,
          user.id,
          challengeId,
          expiresAt
        );

        return {
          kind: "mfa",
          challengeToken,
          expiresIn: mfaMinutes * 60
        };
      }

      await tx`
        UPDATE users
        SET
          failed_login_attempts = 0,
          locked_until = NULL
        WHERE id = ${user.id}
      `;

      return {
        kind: "authenticated",
        userId: user.id
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function handleLoginRoute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    url.pathname !== "/api/v1/auth/login" ||
    request.method.toUpperCase() !== "POST"
  ) {
    return null;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failure(
      "INVALID_REQUEST_BODY",
      "A valid JSON request body is required.",
      400,
      requestId
    );
  }

  const input = validateInput(body);

  if (!input) {
    return failure(
      "INVALID_LOGIN_INPUT",
      "Provide a valid email and password.",
      422,
      requestId
    );
  }

  try {
    const outcome = await performLogin(env, input);

    if (outcome.kind === "invalid" || outcome.kind === "locked") {
      return failure(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
        401,
        requestId
      );
    }

    if (outcome.kind === "unverified") {
      return failure(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email address before signing in.",
        403,
        requestId
      );
    }

    if (outcome.kind === "mfa") {
      return success(
        {
          mfa_required: true,
          challenge_token: outcome.challengeToken,
          expires_in: outcome.expiresIn
        },
        "MFA verification required",
        200,
        requestId
      );
    }

    const session = await createAccessSession(
      env,
      outcome.userId
    );

    return success(
      {
        mfa_required: false,
        access_token: session.accessToken,
        token_type: session.tokenType,
        expires_at: session.expiresAt
      },
      "Login successful",
      200,
      requestId
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "auth.login_failed",
        request_id: requestId,
        error_type:
          error instanceof Error
            ? error.name
            : "UnknownError"
      })
    );

    return failure(
      "LOGIN_TEMPORARILY_UNAVAILABLE",
      "Unable to sign in right now. Please try again later.",
      503,
      requestId
    );
  }
}
