
import bcrypt from "bcryptjs";

const DEFAULT_BCRYPT_ROUNDS = 12;
const MIN_BCRYPT_ROUNDS = 4;
const MAX_BCRYPT_ROUNDS = 16;
const MAX_PASSWORD_LENGTH = 4096;

type ParsedPasswordHash =
  | {
      scheme: "bcrypt_sha256";
      version: 1 | 2;
      variant: "2a" | "2b";
      rounds: number;
      salt: string;
      digest: string;
    }
  | {
      scheme: "bcrypt";
      variant: "2a" | "2b" | "2y";
      rounds: number;
      hash: string;
    };

function validRounds(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;

  const rounds = Number(value);

  if (
    !Number.isInteger(rounds) ||
    rounds < MIN_BCRYPT_ROUNDS ||
    rounds > MAX_BCRYPT_ROUNDS
  ) {
    return null;
  }

  return rounds;
}

function parsePasswordHash(
  encoded: string
): ParsedPasswordHash | null {
  if (typeof encoded !== "string" || encoded.length > 256) {
    return null;
  }

  // Passlib 1.7.3+ bcrypt_sha256 version 2:
  // $bcrypt-sha256$v=2,t=2b,r=12$salt$digest
  const v2 = encoded.match(
    /^\$bcrypt-sha256\$v=2,t=(2b),r=(\d{1,2})\$([./A-Za-z0-9]{22})\$([./A-Za-z0-9]{31})$/
  );

  if (v2) {
    const rounds = validRounds(v2[2]);
    if (rounds === null) return null;

    return {
      scheme: "bcrypt_sha256",
      version: 2,
      variant: "2b",
      rounds,
      salt: v2[3],
      digest: v2[4]
    };
  }

  // Older Passlib bcrypt_sha256 version 1:
  // $bcrypt-sha256$2a,12$salt$digest
  const v1 = encoded.match(
    /^\$bcrypt-sha256\$(2a|2b),(\d{1,2})\$([./A-Za-z0-9]{22})\$([./A-Za-z0-9]{31})$/
  );

  if (v1) {
    const rounds = validRounds(v1[2]);
    if (rounds === null) return null;

    return {
      scheme: "bcrypt_sha256",
      version: 1,
      variant: v1[1] as "2a" | "2b",
      rounds,
      salt: v1[3],
      digest: v1[4]
    };
  }

  // Legacy bcrypt:
  // $2a$12$salt+digest
  // $2b$12$salt+digest
  // $2y$12$salt+digest
  const legacy = encoded.match(
    /^\$(2a|2b|2y)\$(\d{2})\$([./A-Za-z0-9]{53})$/
  );

  if (legacy) {
    const rounds = validRounds(legacy[2]);
    if (rounds === null) return null;

    return {
      scheme: "bcrypt",
      variant: legacy[1] as "2a" | "2b" | "2y",
      rounds,
      hash: encoded
    };
  }

  return null;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

/**
 * Passlib bcrypt_sha256 v2 prehash:
 * HMAC-SHA256(password, key=salt-as-ASCII)
 * followed by standard Base64 encoding.
 */
async function passlibV2Prehash(
  password: string,
  salt: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(password)
  );

  return encodeBase64(new Uint8Array(digest));
}

/**
 * Passlib bcrypt_sha256 v1 prehash:
 * plain SHA-256(password), followed by standard Base64.
 */
async function passlibV1Prehash(
  password: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password)
  );

  return encodeBase64(new Uint8Array(digest));
}

function asBcryptHash(
  variant: "2a" | "2b",
  rounds: number,
  salt: string,
  digest: string
): string {
  return `$${variant}$${String(rounds).padStart(2, "0")}$${salt}${digest}`;
}

function normalizeLegacyBcryptHash(
  hash: string,
  variant: "2a" | "2b" | "2y"
): string {
  if (variant === "2y") {
    // $2y$ is the crypt_blowfish name for the compatible bcrypt variant.
    return `$2b$${hash.slice(4)}`;
  }

  return hash;
}

function validatePasswordInput(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH &&
    !password.includes("\0")
  );
}

/**
 * Verifies a password against hashes produced by the original
 * Passlib CryptContext:
 *
 * CryptContext(
 *   schemes=["bcrypt_sha256", "bcrypt"],
 *   deprecated=["bcrypt"]
 * )
 *
 * Invalid and unsupported hashes return false.
 */
export async function verifyPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  if (!validatePasswordInput(password)) return false;

  const parsed = parsePasswordHash(encodedHash);

  if (!parsed) return false;

  try {
    if (parsed.scheme === "bcrypt") {
      const compatibleHash = normalizeLegacyBcryptHash(
        parsed.hash,
        parsed.variant
      );

      return await bcrypt.compare(password, compatibleHash);
    }

    const prehashed =
      parsed.version === 2
        ? await passlibV2Prehash(password, parsed.salt)
        : await passlibV1Prehash(password);

    const underlyingHash = asBcryptHash(
      parsed.variant,
      parsed.rounds,
      parsed.salt,
      parsed.digest
    );

    return await bcrypt.compare(
      prehashed,
      underlyingHash
    );
  } catch {
    return false;
  }
}

/**
 * Creates a new Passlib-compatible bcrypt_sha256 v2 hash.
 * This is the format used by the original application's preferred scheme.
 */
export async function hashPassword(
  password: string
): Promise<string> {
  if (!validatePasswordInput(password)) {
    throw new Error("Password is invalid or exceeds the supported length.");
  }

  const salt = await bcrypt.genSalt(DEFAULT_BCRYPT_ROUNDS, "2b");

  const saltMatch = salt.match(
    /^\$2b\$\d{2}\$([./A-Za-z0-9]{22})$/
  );

  if (!saltMatch) {
    throw new Error("Unable to generate a valid bcrypt salt.");
  }

  const saltValue = saltMatch[1];
  const prehashed = await passlibV2Prehash(
    password,
    saltValue
  );

  const bcryptHash = await bcrypt.hash(
    prehashed,
    salt
  );

  const result = bcryptHash.match(
    /^\$2b\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/
  );

  if (!result) {
    throw new Error("Unable to generate a compatible password hash.");
  }

  return (
    `$bcrypt-sha256$v=2,t=2b,r=${result[1]}` +
    `$${result[2]}$${result[3]}`
  );
}

/**
 * Indicates whether the existing hash uses the preferred scheme.
 * This is informational; it does not change the stored hash.
 */
export function usesPreferredPasswordScheme(
  encodedHash: string
): boolean {
  return (
    typeof encodedHash === "string" &&
    encodedHash.startsWith("$bcrypt-sha256$")
  );
}
