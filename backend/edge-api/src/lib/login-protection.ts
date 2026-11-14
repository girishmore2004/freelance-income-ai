
import postgres from "postgres";
import type { Env } from "../types";

export interface LoginProtectionResult {
  allowed: boolean;
  reason: "allowed" | "account_locked" | "account_not_found";
  lockedUntil?: string;
}

function getDatabase(env: Env) {
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
      application_name: "Freelance Income AI Edge API - Login Protection"
    }
  });
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new Error("Invalid login protection configuration.");
  }

  return parsed;
}

function failureLimit(env: Env): number {
  return positiveInteger(env.LOGIN_FAILURE_LIMIT, 5, 100);
}

function lockoutMinutes(env: Env): number {
  return positiveInteger(env.LOGIN_LOCKOUT_MINUTES, 15, 1440);
}

/**
 * Checks whether the account is currently allowed to attempt login.
 *
 * Unknown accounts return the same external authentication error as
 * incorrect passwords. Callers must not reveal account existence.
 */
export async function checkLoginEligibility(
  env: Env,
  email: string
): Promise<LoginProtectionResult> {
  const normalizedEmail = email.trim().toLowerCase();

  if (
    !normalizedEmail ||
    normalizedEmail.length > 255
  ) {
    return {
      allowed: false,
      reason: "account_not_found"
    };
  }

  const sql = getDatabase(env);

  try {
    const rows = await sql<{
      locked_until: Date | null;
    }[]>`
      SELECT locked_until
      FROM users
      WHERE email = ${normalizedEmail}
      LIMIT 1
    `;

    if (!rows[0]) {
      return {
        allowed: false,
        reason: "account_not_found"
      };
    }

    const lockedUntil = rows[0].locked_until;

    if (
      lockedUntil &&
      new Date(lockedUntil).getTime() > Date.now()
    ) {
      return {
        allowed: false,
        reason: "account_locked",
        lockedUntil: new Date(lockedUntil).toISOString()
      };
    }

    return {
      allowed: true,
      reason: "allowed"
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Records a failed password or MFA authentication attempt.
 *
 * The row is locked during the transaction to avoid concurrent
 * failed attempts overwriting one another.
 */
export async function recordFailedLoginAttempt(
  env: Env,
  userId: string
): Promise<{
  failedAttempts: number;
  locked: boolean;
  lockedUntil: string | null;
}> {
  if (!userId || userId.length > 36) {
    throw new Error("Invalid user ID.");
  }

  const limit = failureLimit(env);
  const lockMinutes = lockoutMinutes(env);
  const sql = getDatabase(env);

  try {
    return await sql.begin(async (tx) => {
      const users = await tx<{
        failed_login_attempts: number;
        locked_until: Date | null;
      }[]>`
        SELECT failed_login_attempts, locked_until
        FROM users
        WHERE id = ${userId}
        FOR UPDATE
      `;

      const user = users[0];

      if (!user) {
        throw new Error("User not found.");
      }

      const now = new Date();

      if (
        user.locked_until &&
        new Date(user.locked_until).getTime() > now.getTime()
      ) {
        return {
          failedAttempts: Number(user.failed_login_attempts || 0),
          locked: true,
          lockedUntil: new Date(user.locked_until).toISOString()
        };
      }

      const nextAttempts =
        Number(user.failed_login_attempts || 0) + 1;

      if (nextAttempts >= limit) {
        const lockedUntil = new Date(
          now.getTime() + lockMinutes * 60_000
        );

        await tx`
          UPDATE users
          SET
            failed_login_attempts = 0,
            locked_until = ${lockedUntil}
          WHERE id = ${userId}
        `;

        return {
          failedAttempts: 0,
          locked: true,
          lockedUntil: lockedUntil.toISOString()
        };
      }

      await tx`
        UPDATE users
        SET failed_login_attempts = ${nextAttempts}
        WHERE id = ${userId}
      `;

      return {
        failedAttempts: nextAttempts,
        locked: false,
        lockedUntil: null
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Clears the account lockout state after successful password
 * authentication. Call only after password verification succeeds.
 */
export async function clearLoginFailures(
  env: Env,
  userId: string
): Promise<void> {
  if (!userId || userId.length > 36) {
    throw new Error("Invalid user ID.");
  }

  const sql = getDatabase(env);

  try {
    await sql`
      UPDATE users
      SET
        failed_login_attempts = 0,
        locked_until = NULL
      WHERE id = ${userId}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
