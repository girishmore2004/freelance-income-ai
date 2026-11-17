import postgres from "postgres";
import type { Env } from "../types";

export type AccountActionPurpose =
  | "verify_email"
  | "password_reset";

export interface AccountActionToken {
  id: string;
  user_id: string;
  purpose: AccountActionPurpose;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface IssuedAccountActionToken {
  token: string;
  expiresAt: Date;
}

type Sql = ReturnType<typeof postgres>;

const TOKEN_BYTES = 48;
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 256;

const TOKEN_LIFETIMES = {
  verify_email: 24 * 60,
  password_reset: 30
} as const;

function validatePurpose(
  purpose: string
): asserts purpose is AccountActionPurpose {
  if (
    purpose !== "verify_email" &&
    purpose !== "password_reset"
  ) {
    throw new Error("Unsupported account-action token purpose.");
  }
}

function validateUserId(userId: string): void {
  if (
    typeof userId !== "string" ||
    userId.length < 1 ||
    userId.length > 36
  ) {
    throw new Error("Invalid user ID.");
  }
}

/**
 * Python-compatible secrets.token_urlsafe(48).
 * Generates 48 cryptographically secure random bytes,
 * then encodes them using URL-safe Base64 without padding.
 */
function generateActionToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** True when the value has the length the Python VerifyEmailIn/PasswordResetIn schemas accept. */
export function isPlausibleActionToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= TOKEN_MIN_LENGTH && token.length <= TOKEN_MAX_LENGTH;
}

export async function hashActionToken(
  token: string
): Promise<string> {
  if (!isPlausibleActionToken(token)) {
    throw new Error("Invalid account-action token.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createDatabaseClient(env: Env): Sql {
  const connectionString =
    env.HYPERDRIVE?.connectionString;

  if (!connectionString) {
    throw new Error(
      "Hyperdrive database connection is not configured."
    );
  }

  return postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: {
      application_name:
        "Freelance Income AI Edge API - Account Tokens"
    }
  });
}

/**
 * Issues a token using an existing connection or transaction.
 *
 * Matches the original Python implementation:
 * - 48 random bytes, URL-safe Base64 without padding
 * - SHA-256 lowercase hexadecimal digest stored, never the raw token
 * - Previous unused tokens for the same user and purpose are invalidated
 * - Old token records are cleaned up
 */
export async function issueAccountActionTokenWith(
  sql: Sql,
  userId: string,
  purpose: AccountActionPurpose,
  lifetimeMinutes?: number
): Promise<IssuedAccountActionToken> {
  validateUserId(userId);
  validatePurpose(purpose);

  const lifetime =
    lifetimeMinutes ?? TOKEN_LIFETIMES[purpose];

  if (
    !Number.isInteger(lifetime) ||
    lifetime < 1 ||
    lifetime > 60 * 24 * 7
  ) {
    throw new Error("Invalid account-action token lifetime.");
  }

  const rawToken = generateActionToken();
  const tokenHash = await hashActionToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + lifetime * 60_000
  );

  await sql`
    DELETE FROM email_action_tokens
    WHERE
      expires_at < NOW() - INTERVAL '30 days'
      OR used_at < NOW() - INTERVAL '30 days'
  `;

  await sql`
    UPDATE email_action_tokens
    SET used_at = ${now}
    WHERE
      user_id = ${userId}
      AND purpose = ${purpose}
      AND used_at IS NULL
  `;

  // The SQLAlchemy model has no database-side default for the primary key.
  await sql`
    INSERT INTO email_action_tokens (
      id, user_id, token_hash, purpose, created_at, expires_at, used_at
    )
    VALUES (
      ${crypto.randomUUID()}, ${userId}, ${tokenHash}, ${purpose},
      ${now}, ${expiresAt}, NULL
    )
  `;

  return {
    token: rawToken,
    expiresAt
  };
}

/**
 * Atomically consumes a token using an existing connection or transaction.
 * UPDATE ... RETURNING ensures two simultaneous requests cannot both succeed.
 * Expired, used, unknown, malformed and wrong-purpose tokens all return null.
 */
export async function consumeAccountActionTokenWith(
  sql: Sql,
  rawToken: string,
  purpose: AccountActionPurpose
): Promise<AccountActionToken | null> {
  validatePurpose(purpose);

  if (!isPlausibleActionToken(rawToken)) return null;

  const tokenHash = await hashActionToken(rawToken);

  const rows = await sql<AccountActionToken[]>`
    UPDATE email_action_tokens
    SET used_at = NOW()
    WHERE
      token_hash = ${tokenHash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING
      id, user_id, purpose, created_at, expires_at, used_at
  `;

  return rows[0] ?? null;
}

/** Seconds since the most recent token of this purpose was issued, or null if none. */
export async function secondsSinceLastToken(
  sql: Sql,
  userId: string,
  purpose: AccountActionPurpose
): Promise<number | null> {
  validatePurpose(purpose);
  const rows = await sql<{ age: number | string | null }[]>`
    SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) AS age
    FROM email_action_tokens
    WHERE user_id = ${userId} AND purpose = ${purpose}
  `;
  const age = rows[0]?.age;
  return age === null || age === undefined ? null : Number(age);
}

/** Issues a token on its own connection (original API, kept for compatibility). */
export async function issueAccountActionToken(
  env: Env,
  userId: string,
  purpose: AccountActionPurpose,
  lifetimeMinutes?: number
): Promise<IssuedAccountActionToken> {
  const sql = createDatabaseClient(env);

  try {
    return await sql.begin((tx) =>
      issueAccountActionTokenWith(tx, userId, purpose, lifetimeMinutes)
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Consumes a token on its own connection (original API, kept for compatibility). */
export async function consumeAccountActionToken(
  env: Env,
  rawToken: string,
  purpose: AccountActionPurpose
): Promise<AccountActionToken | null> {
  const sql = createDatabaseClient(env);

  try {
    return await consumeAccountActionTokenWith(sql, rawToken, purpose);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function getAccountActionTokenLifetime(
  purpose: AccountActionPurpose
): number {
  validatePurpose(purpose);
  return TOKEN_LIFETIMES[purpose];
}
