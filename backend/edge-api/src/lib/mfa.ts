
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const MFA_KEY_PREFIX = "freelance-income-ai:mfa:v1:";
const FERNET_VERSION = 0x80;
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );

  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base32Encode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/=+$/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of normalized) {
    const index = alphabet.indexOf(char);

    if (index < 0) {
      throw new Error("Invalid Base32 TOTP secret");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Uint8Array.from(output);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function deriveFernetKeys(secretKey: string): Promise<{
  signingKey: Uint8Array;
  encryptionKey: Uint8Array;
}> {
  if (!secretKey) {
    throw new Error("MFA encryption secret is not configured");
  }

  const material = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(encoder.encode(MFA_KEY_PREFIX + secretKey)),
  );

  const key = new Uint8Array(material);

  return {
    signingKey: key.slice(0, 16),
    encryptionKey: key.slice(16, 32),
  };
}

/**
 * Compatible with Python cryptography.fernet.Fernet.
 *
 * Python derives:
 * SHA256("freelance-income-ai:mfa:v1:" + secret_key)
 *
 * Fernet key layout:
 * first 16 bytes = signing key
 * next 16 bytes = AES encryption key
 */
export async function encryptTotpSecret(
  secret: string,
  secretKey: string,
): Promise<string> {
  const { signingKey, encryptionKey } =
    await deriveFernetKeys(secretKey);

  const plaintext = encoder.encode(secret);

  const iv = crypto.getRandomValues(new Uint8Array(16));

  const aesKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encryptionKey),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(plaintext),
  );

  const timestamp = Math.floor(Date.now() / 1000);
  const timestampBytes = new Uint8Array(8);

  let remaining = BigInt(timestamp);

  for (let i = 7; i >= 0; i--) {
    timestampBytes[i] = Number(remaining & 255n);
    remaining >>= 8n;
  }

  const payload = concatBytes(
    new Uint8Array([FERNET_VERSION]),
    timestampBytes,
    iv,
    new Uint8Array(ciphertext),
  );

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    toArrayBuffer(payload),
  );

  return base64UrlEncode(
    concatBytes(payload, new Uint8Array(signature)),
  );
}

/**
 * Decrypts existing Python Fernet ciphertext.
 * Invalid tokens and wrong keys are rejected.
 */
export async function decryptTotpSecret(
  ciphertext: string,
  secretKey: string,
): Promise<string> {
  try {
    const token = base64UrlDecode(ciphertext);

    // Version + timestamp + IV + at least one AES block + HMAC.
    if (token.length < 73 || token[0] !== FERNET_VERSION) {
      throw new Error("Invalid Fernet token");
    }

    const { signingKey, encryptionKey } =
      await deriveFernetKeys(secretKey);

    const signedPayload = token.slice(0, -32);
    const suppliedSignature = token.slice(-32);

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(signingKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const expectedSignature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        hmacKey,
        toArrayBuffer(signedPayload),
      ),
    );

    if (!constantTimeEqual(expectedSignature, suppliedSignature)) {
      throw new Error("Fernet authentication failed");
    }

    const iv = token.slice(9, 25);
    const encrypted = token.slice(25, -32);

    if (encrypted.length === 0 || encrypted.length % 16 !== 0) {
      throw new Error("Invalid Fernet ciphertext");
    }

    const aesKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(encryptionKey),
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(encrypted),
    );

    return decoder.decode(plaintext);
  } catch {
    throw new Error(
      "Unable to decrypt MFA secret; verify SECRET_KEY has not changed.",
    );
  }
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpCode(
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
  period = TOTP_PERIOD,
): Promise<string> {
  if (!Number.isInteger(timestamp) || period <= 0) {
    throw new Error("Invalid TOTP timestamp or period");
  }

  const key = base32Decode(secret);
  const counter = BigInt(Math.floor(timestamp / period));

  const message = new Uint8Array(8);
  let value = counter;

  for (let i = 7; i >= 0; i--) {
    message[i] = Number(value & 255n);
    value >>= 8n;
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      toArrayBuffer(message),
    ),
  );

  const offset = digest[digest.length - 1] & 0x0f;

  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** TOTP_DIGITS).padStart(
    TOTP_DIGITS,
    "0",
  );
}

export async function matchingTotpStep(
  secret: string,
  code: string,
  timestamp = Math.floor(Date.now() / 1000),
  window = 1,
): Promise<number | null> {
  const candidate = String(code);

  if (!/^\d{6}$/.test(candidate)) return null;
  if (!Number.isInteger(window) || window < 0 || window > 10) {
    return null;
  }

  const currentStep = Math.floor(timestamp / TOTP_PERIOD);

  for (let offset = -window; offset <= window; offset++) {
    const step = currentStep + offset;

    if (step < 0) continue;

    const expected = await totpCode(
      secret,
      step * TOTP_PERIOD,
    );

    if (constantTimeEqual(
      encoder.encode(expected),
      encoder.encode(candidate),
    )) {
      return step;
    }
  }

  return null;
}

export async function verifyTotp(
  secret: string,
  code: string,
  timestamp?: number,
  window = 1,
): Promise<boolean> {
  return (
    (await matchingTotpStep(secret, code, timestamp, window)) !== null
  );
}

export function provisioningUri(
  secret: string,
  email: string,
  issuer = "Freelance Income AI",
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);

  return (
    `otpauth://totp/${label}` +
    `?secret=${secret}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    "&algorithm=SHA1&digits=6&period=30"
  );
}

export function generateRecoveryCodes(count = 10): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("Recovery code count must be between 1 and 50");
  }

  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const hex = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 16)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return String(code).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function recoveryCodeHash(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(encoder.encode(normalized)),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
