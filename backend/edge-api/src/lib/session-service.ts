
import postgres from "postgres";
import type { Env } from "../types";

export interface AccessTokenClaims {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  /** Set by staff (migration 0063). A suspended user may sign in, read and appeal only. */
  suspended?: boolean;
}

export interface CreatedSession {
  accessToken: string;
  tokenType: "bearer";
  expiresAt: string;
  userId: string;
}

export interface AuthenticatedSession {
  user: AuthenticatedUser;
  claims: AccessTokenClaims;
}

const DEFAULT_ACCESS_TOKEN_MINUTES = 60;
const MAX_ACCESS_TOKEN_MINUTES = 60 * 24 * 30;
const JWT_ALGORITHM = "HS256";

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
      application_name: "Freelance Income AI Edge API - Sessions"
    }
  });
}

function secret(env: Env): string {
  const value = env.JWT_SECRET?.trim();

  if (!value) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return value;
}

function accessTokenLifetimeMinutes(env: Env): number {
  const raw = env.ACCESS_TOKEN_EXPIRE_MINUTES;

  if (!raw) return DEFAULT_ACCESS_TOKEN_MINUTES;

  const value = Number(raw);

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_ACCESS_TOKEN_MINUTES
  ) {
    throw new Error("ACCESS_TOKEN_EXPIRE_MINUTES is invalid.");
  }

  return value;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(
    new TextEncoder().encode(value)
  );
}

function base64UrlDecodeText(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid JWT encoding.");
  }

  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(
    normalized + "=".repeat((4 - normalized.length % 4) % 4)
  );

  const bytes = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0)
  );

  return new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false
}).decode(bytes);
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret(env)),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}

async function signJwt(
  env: Env,
  claims: AccessTokenClaims
): Promise<string> {
  const header = base64UrlEncodeText(
    JSON.stringify({
      alg: JWT_ALGORITHM,
      typ: "JWT"
    })
  );

  const payload = base64UrlEncodeText(
    JSON.stringify(claims)
  );

  const signingInput = `${header}.${payload}`;
  const key = await hmacKey(env);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncodeBytes(
    new Uint8Array(signature)
  )}`;
}

async function verifyJwtSignature(
  env: Env,
  signingInput: string,
  signature: string
): Promise<boolean> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
      return false;
    }

    const normalized = signature
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const binary = atob(
      normalized + "=".repeat((4 - normalized.length % 4) % 4)
    );

    const signatureBytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0)
    );

    const key = await hmacKey(env);

    return crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );
  } catch {
    return false;
  }
}

function isValidClaims(value: unknown): value is AccessTokenClaims {
  if (!value || typeof value !== "object") return false;

  const claims = value as Record<string, unknown>;

  return (
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    claims.sub.length <= 36 &&
    typeof claims.jti === "string" &&
    claims.jti.length > 0 &&
    claims.jti.length <= 36 &&
    typeof claims.iat === "number" &&
    Number.isInteger(claims.iat) &&
    typeof claims.exp === "number" &&
    Number.isInteger(claims.exp) &&
    claims.exp > claims.iat
  );
}

/**
 * Decode and verify an HS256 JWT.
 *
 * Database session validation is performed separately by
 * authenticateAccessToken().
 */
export async function verifyAccessToken(
  env: Env,
  token: string
): Promise<AccessTokenClaims | null> {
  if (
    typeof token !== "string" ||
    token.length < 20 ||
    token.length > 8192
  ) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;

  let header: Record<string, unknown>;
  let claims: unknown;

  try {
    header = JSON.parse(
      base64UrlDecodeText(encodedHeader)
    ) as Record<string, unknown>;

    claims = JSON.parse(
      base64UrlDecodeText(encodedPayload)
    );
  } catch {
    return null;
  }

  if (
    header.alg !== JWT_ALGORITHM ||
    header.typ !== "JWT" ||
    !isValidClaims(claims)
  ) {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signatureValid = await verifyJwtSignature(
    env,
    signingInput,
    signature
  );

  if (!signatureValid) return null;

  const now = Math.floor(Date.now() / 1000);

  if (claims.exp <= now || claims.iat > now + 60) {
    return null;
  }

  return claims;
}

/**
 * Creates a database-backed session and returns a JWT.
 *
 * This preserves the original backend's claim names and HS256 signing.
 */
export async function createAccessSession(
  env: Env,
  userId: string
): Promise<CreatedSession> {
  if (
    typeof userId !== "string" ||
    userId.length < 1 ||
    userId.length > 36
  ) {
    throw new Error("Invalid user ID.");
  }

  const lifetimeMinutes = accessTokenLifetimeMinutes(env);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + lifetimeMinutes * 60_000
  );

  const tokenId = crypto.randomUUID();

  const claims: AccessTokenClaims = {
    sub: userId,
    jti: tokenId,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000)
  };

  const accessToken = await signJwt(env, claims);
  const sql = database(env);

  try {
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM auth_sessions
        WHERE
          expires_at < NOW() - INTERVAL '90 days'
          OR revoked_at < NOW() - INTERVAL '90 days'
      `;

      await tx`
        INSERT INTO auth_sessions (
          id,
          user_id,
          token_id,
          created_at,
          expires_at,
          revoked_at
        )
        VALUES (
          ${crypto.randomUUID()},
          ${userId},
          ${tokenId},
          ${now},
          ${expiresAt},
          NULL
        )
      `;
    });

    return {
      accessToken,
      tokenType: "bearer",
      expiresAt: expiresAt.toISOString(),
      userId
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Validates the JWT and then checks auth_sessions.
 * A valid signature alone is never sufficient for authentication.
 */
export async function authenticateAccessToken(
  env: Env,
  token: string
): Promise<AuthenticatedSession | null> {
  const claims = await verifyAccessToken(env, token);

  if (!claims) return null;

  const sql = database(env);

  try {
    const rows = await sql<{
      session_user_id: string;
      session_expires_at: Date;
      session_revoked_at: Date | null;
      id: string;
      email: string;
      email_verified: boolean;
      mfa_enabled: boolean;
      suspended: boolean | null;
    }[]>`
      SELECT
        s.user_id AS session_user_id,
        s.expires_at AS session_expires_at,
        s.revoked_at AS session_revoked_at,
        u.id,
        u.email,
        u.email_verified,
        u.mfa_enabled,
        (to_jsonb(u) ->> 'suspended_at') IS NOT NULL AS suspended
      FROM auth_sessions s
      INNER JOIN users u
        ON u.id = s.user_id
      WHERE
        s.token_id = ${claims.jti}
        AND s.user_id = ${claims.sub}
      LIMIT 1
    `;

    const row = rows[0];

    if (!row || row.session_revoked_at !== null) {
      return null;
    }

    const databaseExpiry = new Date(row.session_expires_at);

    if (
      Number.isNaN(databaseExpiry.getTime()) ||
      databaseExpiry.getTime() <= Date.now()
    ) {
      return null;
    }

    if (
      env.REQUIRE_EMAIL_VERIFICATION?.toLowerCase() === "true" &&
      !row.email_verified
    ) {
      return null;
    }

    return {
      user: {
        id: row.id,
        email: row.email,
        email_verified: row.email_verified,
        mfa_enabled: row.mfa_enabled,
        suspended: Boolean(row.suspended)
      },
      claims
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Revokes one session. The user ID condition prevents one user
 * from revoking another user's session by supplying a token ID.
 */
export async function revokeAccessSession(
  env: Env,
  userId: string,
  tokenId: string
): Promise<boolean> {
  if (!userId || !tokenId) return false;

  const sql = database(env);

  try {
    const rows = await sql<{ token_id: string }[]>`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE
        user_id = ${userId}
        AND token_id = ${tokenId}
        AND revoked_at IS NULL
      RETURNING token_id
    `;

    return rows.length > 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Revokes every active session for a user.
 * Used for logout-all, password reset and password change flows.
 */
export async function revokeAllAccessSessions(
  env: Env,
  userId: string
): Promise<number> {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  const sql = database(env);

  try {
    const rows = await sql<{ token_id: string }[]>`
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE
        user_id = ${userId}
        AND revoked_at IS NULL
      RETURNING token_id
    `;

    return rows.length;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
