
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid Base64URL value.");
  }

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(
    normalized + "=".repeat((4 - normalized.length % 4) % 4)
  );

  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const item of arrays) {
    result.set(item, offset);
    offset += item.length;
  }

  return result;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function deriveFernetKey(secretKey: string): Promise<{
  signingKey: Uint8Array;
  encryptionKey: Uint8Array;
}> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      "freelance-income-ai:mfa:v1:" + secretKey
    )
  );

  const key = new Uint8Array(material);

  return {
    signingKey: key.slice(0, 16),
    encryptionKey: key.slice(16, 32)
  };
}

/**
 * Decrypts the existing Python cryptography Fernet token.
 * The token format and key derivation match backend/app/services/mfa.py.
 */
export async function decryptTotpSecret(
  ciphertext: string,
  secretKey: string
): Promise<string> {
  if (!ciphertext || !secretKey) {
    throw new Error("MFA configuration is missing.");
  }

  try {
    const token = decodeBase64Url(ciphertext);

    // Fernet: version(1) + timestamp(8) + IV(16)
    // + ciphertext(multiple of 16) + HMAC(32)
    if (
      token.length < 73 ||
      token[0] !== 0x80 ||
      (token.length - 57) % 16 !== 0
    ) {
      throw new Error("Invalid Fernet token structure.");
    }

    const { signingKey, encryptionKey } =
      await deriveFernetKey(secretKey);

    const signedData = token.slice(0, token.length - 32);
    const suppliedMac = token.slice(token.length - 32);

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      signingKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const authenticated = await crypto.subtle.verify(
      "HMAC",
      hmacKey,
      suppliedMac,
      signedData
    );

    if (!authenticated) {
      throw new Error("Fernet authentication failed.");
    }

    const iv = token.slice(9, 25);
    const encrypted = token.slice(25, token.length - 32);

    const aesKey = await crypto.subtle.importKey(
      "raw",
      encryptionKey,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      aesKey,
      encrypted
    );

    const secret = new TextDecoder("ascii", {
      fatal: true,
      ignoreBOM: false
    }).decode(plaintext);

    if (!/^[A-Z2-7]+=*$/i.test(secret)) {
      throw new Error("Invalid decrypted TOTP secret.");
    }

    return secret;
  } catch {
    throw new Error("MFA configuration cannot be decrypted.");
  }
}

function decodeBase32(secret: string): Uint8Array {
  const normalized = secret.toUpperCase().replace(/=+$/g, "");

  if (
    !normalized ||
    !/^[A-Z2-7]+$/.test(normalized)
  ) {
    throw new Error("Invalid TOTP secret.");
  }

  let bits = "";

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index < 0) throw new Error("Invalid Base32 character.");

    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return new Uint8Array(bytes);
}

function uint64BigEndian(value: number): Uint8Array {
  const result = new Uint8Array(8);
  let current = BigInt(value);

  for (let i = 7; i >= 0; i--) {
    result[i] = Number(current & 255n);
    current >>= 8n;
  }

  return result;
}

async function generateTotp(
  secret: string,
  step: number
): Promise<string> {
  const keyBytes = decodeBase32(secret);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      uint64BigEndian(step)
    )
  );

  const offset = digest[digest.length - 1] & 0x0f;

  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * Matches the original Python matching_totp_step():
 * six digits, 30-second period, window +/- 1.
 */
export async function matchingTotpStep(
  secret: string,
  code: string,
  timestamp = Math.floor(Date.now() / 1000)
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;

  const currentStep = Math.floor(timestamp / 30);

  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    if (step < 0) continue;

    const expected = await generateTotp(secret, step);

    if (constantTimeEqual(
      new TextEncoder().encode(expected),
      new TextEncoder().encode(code)
    )) {
      return step;
    }
  }

  return null;
}

/**
 * Matches Python recovery_code_hash():
 * lowercase, remove all non-alphanumeric characters,
 * then SHA-256 and lowercase hexadecimal.
 */
export async function recoveryCodeHash(
  code: string
): Promise<string> {
  const normalized = String(code)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!normalized || normalized.length > 128) {
    throw new Error("Invalid recovery code.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validates the MFA challenge JWT signature and scope.
 */
export async function verifyMfaChallengeToken(
  token: string,
  secret: string
): Promise<{
  userId: string;
  challengeId: string;
  expiresAt: number;
} | null> {
  if (
    !token ||
    token.length > 8192 ||
    !secret
  ) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const [headerPart, payloadPart, signaturePart] = parts;

    const header = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(headerPart))
    ) as Record<string, unknown>;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payloadPart))
    ) as Record<string, unknown>;

    if (
      header.alg !== "HS256" ||
      header.typ !== "JWT" ||
      payload.scope !== "mfa_challenge" ||
      typeof payload.sub !== "string" ||
      typeof payload.jti !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (
      payload.exp <= now ||
      payload.iat > now + 60 ||
      payload.exp <= payload.iat
    ) {
      return null;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    );

    if (!valid) return null;

    return {
      userId: payload.sub,
      challengeId: payload.jti,
      expiresAt: payload.exp
    };
  } catch {
    return null;
  }
}
