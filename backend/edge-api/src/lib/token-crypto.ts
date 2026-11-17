import type { Env } from "../types";

/**
 * Encryption for third-party OAuth tokens stored by the Edge API.
 *
 * Key material comes from OAUTH_ENCRYPTION_KEY, a secret that is independent
 * of JWT_SECRET (Progress Report finding 2). The value may be the same
 * Fernet-format key the Python service uses (URL-safe base64 of 32 bytes) or
 * any base64/base64url value that decodes to at least 32 bytes.
 *
 * Separate sub-keys are derived with HKDF-SHA-256 so that one secret never
 * serves two purposes directly:
 *   - "fia:oauth-token:v2"  AES-256-GCM key for stored tokens
 *   - "fia:oauth-state:v1"  HMAC-SHA-256 key for signed OAuth `state`
 *
 * Ciphertext format (v2):  v2:<kid>:<iv-b64>:<ciphertext-b64>
 *   kid = first 16 hex characters of SHA-256(raw key material), so a stored
 *   value records which key encrypted it.
 *
 * Rotation:
 *   1. Set OAUTH_ENCRYPTION_KEY_PREVIOUS to the current key and
 *      OAUTH_ENCRYPTION_KEY to the new key, then deploy.
 *   2. Reads succeed with either key; any value not encrypted with the current
 *      key is reported as `needsReencrypt` and rewritten by the caller.
 *   3. The 6-hourly cron rewrites remaining values and logs the event
 *      "oauth_token.key_status". When it reports previous_or_unknown = 0 and
 *      legacy = 0, remove OAUTH_ENCRYPTION_KEY_PREVIOUS (and stop relying on
 *      JWT_SECRET for legacy values).
 *
 * Legacy values (format "<iv-b64>.<ciphertext-b64>") were encrypted with a key
 * derived from JWT_SECRET. They remain readable while JWT_SECRET is unchanged,
 * are always reported as `needsReencrypt`, and are never written again.
 */

export class TokenCryptoConfigError extends Error {
  readonly code = "OAUTH_ENCRYPTION_NOT_CONFIGURED";
}

export class TokenDecryptError extends Error {
  readonly code = "TOKEN_DECRYPT_FAILED";
}

export interface DecryptedSecret {
  plaintext: string;
  needsReencrypt: boolean;
  scheme: "v2-current" | "v2-previous" | "legacy-jwt";
}

interface KeySet {
  kid: string;
  aes: CryptoKey;
  stateHmac: CryptoKey;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MIN_KEY_BYTES = 32;
const STATE_TTL_MS = 15 * 60_000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeKeyMaterial(raw: string, name: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(raw);
  } catch {
    throw new TokenCryptoConfigError(`${name} must be base64 or base64url encoded`);
  }
  if (bytes.length < MIN_KEY_BYTES) {
    throw new TokenCryptoConfigError(`${name} must decode to at least ${MIN_KEY_BYTES} bytes`);
  }
  return bytes;
}

async function deriveKeySet(raw: string, name: string): Promise<KeySet> {
  const material = decodeKeyMaterial(raw, name);
  const kid = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", material))).slice(0, 16);
  const base = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
  const salt = encoder.encode("freelance-income-ai");
  const aes = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("fia:oauth-token:v2") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const stateHmac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("fia:oauth-state:v1") },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
  return { kid, aes, stateHmac };
}

async function currentKeys(env: Env): Promise<KeySet> {
  const raw = String(env.OAUTH_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new TokenCryptoConfigError(
      "OAUTH_ENCRYPTION_KEY is not configured. Add it as a Cloudflare secret before connecting integrations."
    );
  }
  return deriveKeySet(raw, "OAUTH_ENCRYPTION_KEY");
}

async function previousKeys(env: Env): Promise<KeySet | null> {
  const raw = String(env.OAUTH_ENCRYPTION_KEY_PREVIOUS ?? "").trim();
  return raw ? deriveKeySet(raw, "OAUTH_ENCRYPTION_KEY_PREVIOUS") : null;
}

/** Key id of OAUTH_ENCRYPTION_KEY (safe to log; reveals nothing about the key). */
export async function currentKeyId(env: Env): Promise<string> {
  return (await currentKeys(env)).kid;
}

/** True when new tokens can be encrypted (connect flows must check this). */
export function tokenEncryptionConfigured(env: Env): boolean {
  const raw = String(env.OAUTH_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return false;
  try {
    decodeKeyMaterial(raw, "OAUTH_ENCRYPTION_KEY");
    return true;
  } catch {
    return false;
  }
}

export async function encryptSecret(env: Env, plaintext: string): Promise<string> {
  const keys = await currentKeys(env);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`v2:${keys.kid}`) }, keys.aes, encoder.encode(plaintext))
  );
  return `v2:${keys.kid}:${bytesToBase64(iv)}:${bytesToBase64(cipher)}`;
}

async function legacyKey(env: Env): Promise<CryptoKey> {
  const secret = String(env.JWT_SECRET ?? "");
  if (!secret) throw new TokenDecryptError("Legacy token cannot be read: JWT_SECRET is not configured");
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(`integration-tokens|${secret}`));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
}

export async function decryptSecret(env: Env, stored: string): Promise<DecryptedSecret> {
  if (typeof stored !== "string" || stored.length === 0) {
    throw new TokenDecryptError("No stored secret");
  }

  if (stored.startsWith("v2:")) {
    const parts = stored.split(":");
    if (parts.length !== 4) throw new TokenDecryptError("Malformed v2 secret");
    const [, kid, ivB64, dataB64] = parts;
    const current = await currentKeys(env).catch((error: unknown) => {
      if (error instanceof TokenCryptoConfigError) return null;
      throw error;
    });
    const previous = await previousKeys(env);
    const candidates: Array<{ keys: KeySet; scheme: DecryptedSecret["scheme"] }> = [];
    if (current && current.kid === kid) candidates.push({ keys: current, scheme: "v2-current" });
    if (previous && previous.kid === kid) candidates.push({ keys: previous, scheme: "v2-previous" });
    if (candidates.length === 0) {
      throw new TokenDecryptError(`No configured key matches key id ${kid}. Restore OAUTH_ENCRYPTION_KEY_PREVIOUS.`);
    }
    const { keys, scheme } = candidates[0];
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(ivB64), additionalData: encoder.encode(`v2:${kid}`) },
        keys.aes,
        base64ToBytes(dataB64)
      );
      return { plaintext: decoder.decode(plain), needsReencrypt: scheme !== "v2-current", scheme };
    } catch {
      throw new TokenDecryptError("Stored secret failed authentication (wrong key or tampered value)");
    }
  }

  const legacy = stored.split(".");
  if (legacy.length !== 2) throw new TokenDecryptError("Unrecognised secret format");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(legacy[0]) },
      await legacyKey(env),
      base64ToBytes(legacy[1])
    );
    return { plaintext: decoder.decode(plain), needsReencrypt: true, scheme: "legacy-jwt" };
  } catch (error) {
    if (error instanceof TokenDecryptError) throw error;
    throw new TokenDecryptError("Legacy secret could not be decrypted (JWT_SECRET changed or value tampered)");
  }
}

/** Classify a stored value without decrypting it (for rotation progress reporting). */
export async function storedSecretScheme(env: Env, stored: string): Promise<"current" | "other" | "legacy" | "empty"> {
  if (!stored) return "empty";
  if (!stored.startsWith("v2:")) return "legacy";
  const kid = stored.split(":")[1] ?? "";
  try {
    return (await currentKeys(env)).kid === kid ? "current" : "other";
  } catch {
    return "other";
  }
}

/* ------------------------------------------------------------------ */
/* Signed OAuth state                                                  */
/* ------------------------------------------------------------------ */

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Returns `<userId>.<issuedAtMs>.<nonce>.<hmac>`; valid for 15 minutes. */
export async function signOAuthState(env: Env, userId: string, nowMs = Date.now()): Promise<string> {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error("Invalid user id for OAuth state");
  const keys = await currentKeys(env);
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12))));
  const body = `${userId}.${nowMs}.${nonce}`;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", keys.stateHmac, encoder.encode(body)));
  return `${body}.${base64Url(mac)}`;
}

/** Returns the user id when the state is authentic and unexpired, otherwise null. */
export async function verifyOAuthState(env: Env, state: string, nowMs = Date.now()): Promise<string | null> {
  if (typeof state !== "string" || state.length > 400) return null;
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, issued, nonce, mac] = parts;
  const issuedAt = Number(issued);
  if (!/^[\w-]{1,64}$/.test(userId) || !Number.isFinite(issuedAt)) return null;
  if (nowMs - issuedAt > STATE_TTL_MS || issuedAt - nowMs > 60_000) return null;
  let keys: KeySet;
  try {
    keys = await currentKeys(env);
  } catch {
    return null;
  }
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64ToBytes(mac);
  } catch {
    return null;
  }
  // crypto.subtle.verify performs a constant-time comparison.
  const ok = await crypto.subtle.verify("HMAC", keys.stateHmac, signature, encoder.encode(`${userId}.${issued}.${nonce}`));
  return ok ? userId : null;
}
