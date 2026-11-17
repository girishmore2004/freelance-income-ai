import { describe, expect, it } from "vitest";
import { buildMime, decryptToken, encryptToken, findContactEmail, makeState, readState } from "./apply-agent";
import type { Env } from "../types";

const env = {
  JWT_SECRET: "test-secret-value-1234567890",
  OAUTH_ENCRYPTION_KEY: "q2Xh0b3S3m5yYk9zQ2l3bkF0cGx1S3J0dlZ1UjR3c0E="
} as unknown as Env;

describe("apply agent helpers", () => {
  it("encrypts and decrypts tokens", async () => {
    const stored = await encryptToken(env, "refresh-token-abc");
    expect(stored).not.toContain("refresh-token-abc");
    expect(await decryptToken(env, stored)).toBe("refresh-token-abc");
  });

  it("signs OAuth state and rejects tampering", async () => {
    const state = await makeState(env, "user-1");
    expect(await readState(env, state)).toBe("user-1");
    expect(await readState(env, state.replace("user-1", "user-2"))).toBeNull();
    expect(await readState(env, "garbage")).toBeNull();
  });

  it("finds contact emails, including [at] style", () => {
    expect(findContactEmail("Send CV to jobs [at] acme [dot] io please")).toBe("jobs@acme.io");
    expect(findContactEmail("no-reply@x.com and hello@y.dev")).toBe("hello@y.dev");
    expect(findContactEmail("no email here")).toBeNull();
  });

  it("builds a threaded MIME message", () => {
    const mime = buildMime("me@x.com", "a@b.com", "Hi", "Body text", { messageId: "<id1@x>", references: "<id1@x>" });
    expect(mime).toContain("To: a@b.com");
    expect(mime).toContain("In-Reply-To: <id1@x>");
    expect(mime).toContain("Content-Transfer-Encoding: base64");
  });
});
