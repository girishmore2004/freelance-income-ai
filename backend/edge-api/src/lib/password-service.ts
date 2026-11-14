
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
    return `$2b$${hash.slice(4)}`;
  }

  return hash;
}

function validatePasswordInput(
  password: unknown
): password is string {
  return (
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH &&
    !password.includes("\0")
  );
}


function generateSalt(rounds: number): Promise<string> {
  return new Promise((resolve, reject) => {
    bcrypt.genSalt(rounds, (error, salt) => {
      if (error) {
        reject(error);
        return;
      }

      if (typeof salt !== "string" || salt.length === 0) {
        reject(new Error("bcrypt did not generate a valid salt."));
        return;
      }

      resolve(salt);
    });
  });
}

function hashWithSalt(
  password: string,
  salt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, salt, (error, hash) => {
      if (error) {
        reject(error);
        return;
      }

      if (typeof hash !== "string" || hash.length === 0) {
        reject(new Error("bcrypt did not generate a valid hash."));
        return;
      }

      resolve(hash);
    });
  });
}

function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    bcrypt.compare(password, hash, (error, matched) => {
      if (error) {
        reject(error);
        return;
      }

      if (typeof matched !== "boolean") {
        reject(new Error("bcrypt returned an invalid comparison result."));
        return;
      }

      resolve(matched);
    });
  });
}


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

      return await comparePassword(password, compatibleHash);
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

    return await comparePassword(
      prehashed,
      underlyingHash
    );
  } catch {
    return false;
  }
}

export async function hashPassword(
  password: string
): Promise<string> {
  if (!validatePasswordInput(password)) {
    throw new Error(
      "Password is invalid or exceeds the supported length."
    );
  }

  const salt = await generateSalt(DEFAULT_BCRYPT_ROUNDS);

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

  const bcryptHash = await hashWithSalt(
    prehashed,
    salt
  );

  const result = bcryptHash.match(
    /^\$2b\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/
  );

  if (!result) {
    throw new Error(
      "Unable to generate a compatible password hash."
    );
  }

  return (
    `$bcrypt-sha256$v=2,t=2b,r=${result[1]}` +
    `$${result[2]}$${result[3]}`
  );
}

export function usesPreferredPasswordScheme(
  encodedHash: string
): boolean {
  return (
    typeof encodedHash === "string" &&
    encodedHash.startsWith("$bcrypt-sha256$")
  );
}
