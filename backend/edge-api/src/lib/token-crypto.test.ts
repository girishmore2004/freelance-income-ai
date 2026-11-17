import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import {
  bytesToBase64,
  currentKeyId,
  decryptSecret,
  encryptSecret,
  signOAuthState,
  storedSecretScheme,
  tokenEncryptionConfigured,
  verifyOAuthState
} from "./token-crypto";
import { reencryptIntegrationTokens } from "./apply-agent";
import type { Sql } from "./core-routes";

// Test-only key material (32 random-looking bytes, base64). Never real secrets.
const KEY_A = "q2Xh0b3S3m5yYk9zQ2l3bkF0cGx1S3J0dlZ1UjR3c0E=";
const KEY_B = "UGx1dG9OZXh0S2V5Rm9yUm90YXRpb25UZXN0c09ubHk=";
const JWT = "legacy-jwt-secret-value-0123456789";

const env = (extra: Partial<Env> = {}): Env => ({ JWT_SECRET: JWT, OAUTH_ENCRYPTION_KEY: KEY_A, ...extra }) as unknown as Env;

/** Reproduces the pre-5.46 Edge format (key = SHA-256("integration-tokens|" + JWT_SECRET)). */
async function legacyEncrypt(secret: string, plain: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`integration-tokens|${secret}`));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `${bytesToBase64(iv)}.${bytesToBase64(data)}`;
}

type Call = { text: string; values: unknown[] };
function fakeSql(rows: Record<string, unknown>[]): { sql: Sql; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return Promise.resolve(text.trim().startsWith("SELECT") ? rows : []);
  };
  return { sql: fn as unknown as Sql, calls };
}

describe("OAuth token encryption (OAUTH_ENCRYPTION_KEY)", () => {
  it("round-trips and never stores plaintext", async () => {
    const stored = await encryptSecret(env(), "refresh-token-abc");
    expect(stored.startsWith("v2:")).toBe(true);
    expect(stored).not.toContain("refresh-token-abc");
    const out = await decryptSecret(env(), stored);
    expect(out).toEqual({ plaintext: "refresh-token-abc", needsReencrypt: false, scheme: "v2-current" });
  });

  it("does not depend on JWT_SECRET for new values", async () => {
    const stored = await encryptSecret(env(), "tok");
    const out = await decryptSecret(env({ JWT_SECRET: "rotated-login-secret-xxxxxxxxxxxx" }), stored);
    expect(out.plaintext).toBe("tok");
  });

  it("refuses to encrypt without a dedicated key", async () => {
    await expect(encryptSecret(env({ OAUTH_ENCRYPTION_KEY: "" }), "x")).rejects.toThrow("OAUTH_ENCRYPTION_KEY is not configured");
    await expect(encryptSecret(env({ OAUTH_ENCRYPTION_KEY: "c2hvcnQ=" }), "x")).rejects.toThrow("at least 32 bytes");
    expect(tokenEncryptionConfigured(env({ OAUTH_ENCRYPTION_KEY: "" }))).toBe(false);
    expect(tokenEncryptionConfigured(env())).toBe(true);
  });

  it("detects tampering", async () => {
    const stored = await encryptSecret(env(), "secret");
    const parts = stored.split(":");
    const data = parts[3];
    const flipped = (data[0] === "A" ? "B" : "A") + data.slice(1);
    await expect(decryptSecret(env(), `${parts[0]}:${parts[1]}:${parts[2]}:${flipped}`)).rejects.toThrow("failed authentication");
  });

  it("reads legacy JWT-derived values and flags them for re-encryption", async () => {
    const legacy = await legacyEncrypt(JWT, "old-refresh");
    const out = await decryptSecret(env(), legacy);
    expect(out).toEqual({ plaintext: "old-refresh", needsReencrypt: true, scheme: "legacy-jwt" });
    expect(await storedSecretScheme(env(), legacy)).toBe("legacy");
  });

  it("supports rotation through OAUTH_ENCRYPTION_KEY_PREVIOUS", async () => {
    const underA = await encryptSecret(env(), "rotate-me");
    const rotated = env({ OAUTH_ENCRYPTION_KEY: KEY_B, OAUTH_ENCRYPTION_KEY_PREVIOUS: KEY_A });
    const out = await decryptSecret(rotated, underA);
    expect(out).toEqual({ plaintext: "rotate-me", needsReencrypt: true, scheme: "v2-previous" });
    expect(await storedSecretScheme(rotated, underA)).toBe("other");
    // Without the previous key the value is unreadable, and the error says how to recover.
    await expect(decryptSecret(env({ OAUTH_ENCRYPTION_KEY: KEY_B }), underA)).rejects.toThrow("OAUTH_ENCRYPTION_KEY_PREVIOUS");
    expect(await currentKeyId(rotated)).not.toBe(await currentKeyId(env()));
  });

  it("re-encrypts legacy and previous-key rows onto the current key", async () => {
    const legacy = await legacyEncrypt(JWT, "legacy-refresh");
    const underA = await encryptSecret(env(), "a-access");
    const rotated = env({ OAUTH_ENCRYPTION_KEY: KEY_B, OAUTH_ENCRYPTION_KEY_PREVIOUS: KEY_A });
    const { sql, calls } = fakeSql([{ user_id: "u1", provider: "gmail", refresh_token: legacy, access_token: underA }]);

    const result = await reencryptIntegrationTokens(rotated, sql, 10);
    expect(result).toEqual({ scanned: 1, reencrypted: 1, failed: 0 });

    const update = calls.find((c) => c.text.includes("UPDATE integrations"));
    expect(update).toBeDefined();
    const [newRefresh, newAccess] = update!.values as string[];
    expect(await storedSecretScheme(rotated, newRefresh)).toBe("current");
    expect((await decryptSecret(rotated, newRefresh)).plaintext).toBe("legacy-refresh");
    expect((await decryptSecret(rotated, newAccess)).plaintext).toBe("a-access");
    expect(update!.values).toContain("u1");
  });

  it("reports undecryptable rows without deleting them", async () => {
    const { sql, calls } = fakeSql([{ user_id: "u1", provider: "gmail", refresh_token: "garbage.value", access_token: "" }]);
    const result = await reencryptIntegrationTokens(env(), sql, 10);
    expect(result).toEqual({ scanned: 1, reencrypted: 0, failed: 1 });
    expect(calls.some((c) => /DELETE|UPDATE/.test(c.text))).toBe(false);
  });
});

describe("signed OAuth state", () => {
  it("round-trips the user id and rejects tampering", async () => {
    const state = await signOAuthState(env(), "user-1");
    expect(await verifyOAuthState(env(), state)).toBe("user-1");
    expect(await verifyOAuthState(env(), state.replace("user-1", "user-2"))).toBeNull();
    expect(await verifyOAuthState(env(), "garbage")).toBeNull();
  });

  it("expires after 15 minutes", async () => {
    const issued = Date.UTC(2026, 10, 17, 10, 0, 0);
    const state = await signOAuthState(env(), "user-1", issued);
    expect(await verifyOAuthState(env(), state, issued + 14 * 60_000)).toBe("user-1");
    expect(await verifyOAuthState(env(), state, issued + 16 * 60_000)).toBeNull();
  });

  it("is not forgeable with JWT_SECRET alone", async () => {
    const state = await signOAuthState(env(), "user-1");
    expect(await verifyOAuthState(env({ OAUTH_ENCRYPTION_KEY: KEY_B }), state)).toBeNull();
  });
});
