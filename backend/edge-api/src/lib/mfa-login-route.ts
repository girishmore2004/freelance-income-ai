
import postgres from "postgres";
import type { Env } from "../types";

import { createAccessSession } from "./session-service";
import {
  decryptTotpSecret,
  matchingTotpStep,
  recoveryCodeHash,
  verifyMfaChallengeToken
} from "./mfa-service";

import { failure, success } from "./response";

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
      application_name: "Freelance Income AI Edge API - MFA Login"
    }
  });
}

function positiveInteger(
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
    throw new Error("Invalid MFA configuration.");
  }

  return value;
}

interface MfaInput {
  challenge_token: string;
  code: string;
}

function validateInput(value: unknown): MfaInput | null {
  if (!value || typeof value !== "object") return null;

  const input = value as Record<string, unknown>;

  if (
    typeof input.challenge_token !== "string" ||
    typeof input.code !== "string" ||
    input.challenge_token.length > 8192 ||
    input.code.length > 128 ||
    input.code.trim().length === 0
  ) {
    return null;
  }

  return {
    challenge_token: input.challenge_token,
    code: input.code.trim()
  };
}

type VerificationOutcome =
  | { kind: "invalid" }
  | { kind: "decrypt_error" }
  | { kind: "success"; userId: string };

export async function handleMfaLoginRoute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method.toUpperCase() !== "POST" ||
    url.pathname !== "/api/v1/auth/mfa/verify-login"
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
      "INVALID_MFA_INPUT",
      "A challenge token and authenticator or recovery code are required.",
      422,
      requestId
    );
  }

  const jwtSecret = env.JWT_SECRET?.trim();

  if (!jwtSecret) {
    return failure(
      "MFA_CONFIGURATION_ERROR",
      "MFA authentication is not configured.",
      503,
      requestId
    );
  }

  const claims = await verifyMfaChallengeToken(
    input.challenge_token,
    jwtSecret
  );

  if (!claims) {
    return failure(
      "INVALID_MFA_CHALLENGE",
      "MFA challenge is invalid or expired.",
      401,
      requestId
    );
  }

  const maxAttempts = positiveInteger(
    env.MFA_CHALLENGE_MAX_ATTEMPTS,
    5,
    20
  );

  const loginLimit = positiveInteger(
    env.LOGIN_FAILURE_LIMIT,
    5,
    100
  );

  const lockoutMinutes = positiveInteger(
    env.LOGIN_LOCKOUT_MINUTES,
    15,
    1440
  );

  const sql = database(env);

  let outcome: VerificationOutcome;

  try {
    outcome = await sql.begin(async tx => {
      const users = await tx<{
        id: string;
        mfa_enabled: boolean;
        mfa_secret_encrypted: string;
        mfa_last_used_step: number | null;
        failed_login_attempts: number;
        locked_until: Date | null;
      }[]>`
        SELECT
          id,
          mfa_enabled,
          mfa_secret_encrypted,
          mfa_last_used_step,
          failed_login_attempts,
          locked_until
        FROM users
        WHERE id = ${claims.userId}
        FOR UPDATE
      `;

      const user = users[0];

      const challenges = await tx<{
        challenge_id: string;
        expires_at: Date;
        used_at: Date | null;
        attempts: number;
      }[]>`
        SELECT
          challenge_id,
          expires_at,
          used_at,
          attempts
        FROM mfa_challenges
        WHERE
          challenge_id = ${claims.challengeId}
          AND user_id = ${claims.userId}
        FOR UPDATE
      `;

      const challenge = challenges[0];
      const now = new Date();

      if (
        !user ||
        !challenge ||
        challenge.used_at !== null ||
        !user.mfa_enabled
      ) {
        return { kind: "invalid" };
      }

      const lockedUntil = user.locked_until
        ? new Date(user.locked_until)
        : null;

      if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
        return { kind: "invalid" };
      }

      if (
        new Date(challenge.expires_at).getTime() <= now.getTime() ||
        Number(challenge.attempts) >= maxAttempts
      ) {
        await tx`
          UPDATE mfa_challenges
          SET used_at = ${now}
          WHERE challenge_id = ${claims.challengeId}
        `;

        return { kind: "invalid" };
      }

      let matchingStep: number | null = null;
      let valid = false;

      try {
        const secret = await decryptTotpSecret(
          user.mfa_secret_encrypted,
          jwtSecret
        );

        const candidateStep = await matchingTotpStep(
          secret,
          input.code
        );

        if (
          candidateStep !== null &&
          (
            user.mfa_last_used_step === null ||
            candidateStep > user.mfa_last_used_step
          )
        ) {
          matchingStep = candidateStep;
          valid = true;
        }
      } catch {
        return { kind: "decrypt_error" };
      }

      if (!valid) {
        let digest: string;

        try {
          digest = await recoveryCodeHash(input.code);
        } catch {
          digest = "";
        }

        if (digest) {
          const recoveryRows = await tx<{
            id: string;
          }[]>`
            SELECT id
            FROM mfa_recovery_codes
            WHERE
              user_id = ${user.id}
              AND code_hash = ${digest}
              AND used_at IS NULL
            FOR UPDATE
          `;

          const recovery = recoveryRows[0];

          if (recovery) {
            await tx`
              UPDATE mfa_recovery_codes
              SET used_at = ${now}
              WHERE
                id = ${recovery.id}
                AND used_at IS NULL
            `;

            valid = true;
          }
        }
      }

      if (!valid) {
        const nextAttempts =
          Number(challenge.attempts) + 1;

        const failedAttempts =
          Number(user.failed_login_attempts || 0) + 1;

        const lockAccount = failedAttempts >= loginLimit;

        await tx`
          UPDATE mfa_challenges
          SET
            attempts = ${nextAttempts},
            used_at = ${
              nextAttempts >= maxAttempts ? now : null
            }
          WHERE challenge_id = ${claims.challengeId}
        `;

        if (lockAccount) {
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
            SET failed_login_attempts = ${failedAttempts}
            WHERE id = ${user.id}
          `;
        }

        return { kind: "invalid" };
      }

      await tx`
        UPDATE mfa_challenges
        SET used_at = ${now}
        WHERE challenge_id = ${claims.challengeId}
      `;

      await tx`
        UPDATE users
        SET
          failed_login_attempts = 0,
          locked_until = NULL,
          mfa_last_used_step = ${
            matchingStep === null
              ? user.mfa_last_used_step
              : matchingStep
          }
        WHERE id = ${user.id}
      `;

      return {
        kind: "success",
        userId: user.id
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (outcome.kind === "decrypt_error") {
    return failure(
      "MFA_DECRYPTION_FAILED",
      "MFA configuration cannot be decrypted. Contact the administrator.",
      503,
      requestId
    );
  }

  if (outcome.kind === "invalid") {
    return failure(
      "INVALID_MFA_CODE",
      "Invalid authenticator or recovery code.",
      401,
      requestId
    );
  }

  try {
    const session = await createAccessSession(
      env,
      outcome.userId
    );

    return success(
      {
        access_token: session.accessToken,
        token_type: session.tokenType,
        expires_at: session.expiresAt
      },
      "MFA verification successful",
      200,
      requestId
    );
  } catch {
    return failure(
      "SESSION_CREATION_FAILED",
      "MFA was verified, but a session could not be created. Please sign in again.",
      503,
      requestId
    );
  }
}
