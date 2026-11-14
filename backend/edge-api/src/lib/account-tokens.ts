const TOKEN_BYTES = 32;
const TOKEN_HASH_LENGTH = 64;

/**
 * Generate a cryptographically secure, URL-safe action token.
 * The raw token is returned once to the caller; only its SHA-256
 * hash should ever be stored in the database.
 */
export function generateActionToken(): string {
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

/**
 * Hash a raw action token using SHA-256.
 * The result is a lowercase 64-character hexadecimal string,
 * compatible with the original EmailActionToken.token_hash column.
 */
export async function hashActionToken(token: string): Promise<string> {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) {
    throw new Error("Invalid action token.");
  }

  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (hash.length !== TOKEN_HASH_LENGTH) {
    throw new Error("Unexpected action-token hash length.");
  }

  return hash;
}

/**
 * Calculate an expiry timestamp in milliseconds.
 * Callers should persist this as a PostgreSQL timestamptz value.
 */
export function actionTokenExpiry(
  lifetimeMinutes: number,
  nowMs = Date.now(),
): number {
  if (
    !Number.isInteger(lifetimeMinutes) ||
    lifetimeMinutes < 1 ||
    lifetimeMinutes > 60 * 24 * 7
  ) {
    throw new Error("Invalid action-token lifetime.");
  }

  return nowMs + lifetimeMinutes * 60_000;
}

/**
 * Fixed lifetimes used by the original application.
 */
export const ACTION_TOKEN_LIFETIMES = {
  verifyEmailMinutes: 24 * 60,
  passwordResetMinutes: 30,
} as const;
