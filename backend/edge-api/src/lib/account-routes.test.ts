import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { handleAccountRoute } from "./account-routes";
import type { AccountRouteDeps } from "./account-routes";
import { accountMailConfigured, sendAccountEmail } from "./account-mailer";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const mailEnv = {
  JWT_SECRET: "x".repeat(40),
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_test_placeholder",
  RESEND_FROM_EMAIL: "no-reply@example.test",
  PUBLIC_APP_URL: "https://app.example.test"
} as unknown as Env;

const TOKEN = "t".repeat(64);

function session(userId = "u1", jti = "jti-current"): AuthenticatedSession {
  return {
    user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false },
    claims: { sub: userId, jti, iat: 0, exp: 0 }
  };
}

function deps(handler: (text: string, values: unknown[]) => unknown[], overrides: Partial<AccountRouteDeps> = {}) {
  const fake = createFakeSql(handler);
  const sendEmail = vi.fn(async () => ({ id: "email-1" }));
  const d: AccountRouteDeps = {
    database: () => fake.sql,
    authenticate: async () => session(),
    sendEmail: sendEmail as unknown as AccountRouteDeps["sendEmail"],
    issueSession: async (_env, userId) => ({ accessToken: `new-jwt-for-${userId}`, tokenType: "bearer", expiresAt: "2030-01-01T00:00:00Z", userId }),
    ...overrides
  };
  return { fake, sendEmail, d };
}

describe("public account routes", () => {
  it("ignores unrelated paths", async () => {
    const { d } = deps(() => []);
    expect(await handleAccountRoute(jsonRequest("GET", "/api/v1/profile"), mailEnv, "r", d)).toBeNull();
  });

  it("verifies email with a single-use token inside one transaction", async () => {
    const { fake, d } = deps((text) => {
      if (text.startsWith("UPDATE email_action_tokens")) return [{ id: "tok", user_id: "u1", purpose: "verify_email" }];
      if (text.startsWith("UPDATE users SET email_verified = true")) return [{ id: "u1" }];
      return [];
    });
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/verify-email", { token: TOKEN }), mailEnv, "r", d);
    expect(response!.status).toBe(200);
    expect((await readJson(response!)).data.status).toBe("verified");
    expect(fake.queries.every((q) => q.inTransaction)).toBe(true);
    // The raw token is never sent to the database, only its SHA-256 hash.
    expect(fake.queries.some((q) => q.values.includes(TOKEN))).toBe(false);
  });

  it("rejects used, expired or malformed verification tokens with the Python message", async () => {
    const { d } = deps(() => []);
    for (const token of [TOKEN, "short", 42]) {
      const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/verify-email", { token }), mailEnv, "r", d);
      expect(response!.status).toBe(400);
      expect((await readJson(response!)).message).toBe("Verification link is invalid, expired or already used.");
    }
  });

  it("returns the same neutral reply for known and unknown addresses", async () => {
    const known = deps((text) => (text.startsWith("SELECT id, email, email_verified") ? [{ id: "u1", email: "a@x.test", email_verified: true }] : text.startsWith("SELECT EXTRACT") ? [{ age: null }] : []));
    const unknown = deps(() => []);
    const r1 = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/password-reset/request", { email: "a@x.test" }), mailEnv, "r", known.d);
    const r2 = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/password-reset/request", { email: "nobody@x.test" }), mailEnv, "r", unknown.d);
    const b1 = await readJson(r1!);
    const b2 = await readJson(r2!);
    expect(r1!.status).toBe(r2!.status);
    expect(b1.message).toBe(b2.message);
    expect(known.sendEmail).toHaveBeenCalledTimes(1);
    expect(unknown.sendEmail).toHaveBeenCalledTimes(0);
    const [, message] = (known.sendEmail as unknown as { mock: { calls: [Env, { to: string; text: string }][] } }).mock.calls[0];
    expect(message.to).toBe("a@x.test");
    expect(message.text).toMatch(/^Use this link .*\n\nhttps:\/\/app\.example\.test\/#reset_token=[A-Za-z0-9_-]{64}/);
  });

  it("rate-limits repeat emails for one account (60 s cooldown)", async () => {
    const { sendEmail, d } = deps((text) => (text.startsWith("SELECT id, email, email_verified") ? [{ id: "u1", email: "a@x.test", email_verified: false }] : text.startsWith("SELECT EXTRACT") ? [{ age: 12 }] : []));
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/resend-verification", { email: "a@x.test" }), mailEnv, "r", d);
    expect(response!.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(0);
  });

  it("rolls back the issued token when the email provider fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("provider down");
    });
    const { fake, d } = deps(
      (text) => (text.startsWith("SELECT id, email, email_verified") ? [{ id: "u1", email: "a@x.test", email_verified: false }] : text.startsWith("SELECT EXTRACT") ? [{ age: null }] : []),
      { sendEmail: failing as unknown as AccountRouteDeps["sendEmail"] }
    );
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/resend-verification", { email: "a@x.test" }), mailEnv, "r", d);
    expect(response!.status).toBe(200);
    expect(fake.rollbacks).toBe(1);
    expect(fake.commits).toBe(0);
  });

  it("does not send email when delivery is not configured", async () => {
    const { sendEmail, d } = deps(() => [{ id: "u1", email: "a@x.test", email_verified: false }]);
    const env = { ...mailEnv, RESEND_API_KEY: "" } as Env;
    expect(accountMailConfigured(env)).toBe(false);
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/resend-verification", { email: "a@x.test" }), env, "r", d);
    expect(response!.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(0);
  });

  it("validates the new password before consuming a reset token", async () => {
    const { fake, d } = deps(() => []);
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/password-reset/confirm", { token: TOKEN, new_password: "short" }), mailEnv, "r", d);
    expect(response!.status).toBe(422);
    expect(fake.queries).toHaveLength(0);
  });
});

describe("private account routes", () => {
  it("requires authentication", async () => {
    const { d } = deps(() => [], {
      authenticate: async () => new Response(JSON.stringify({ success: false }), { status: 401 })
    });
    const response = await handleAccountRoute(jsonRequest("GET", "/api/v1/auth/sessions"), mailEnv, "r", d);
    expect(response!.status).toBe(401);
  });

  it("lists only the caller's sessions and marks the current one", async () => {
    const { fake, d } = deps(() => [
      { id: "s1", token_id: "jti-current", created_at: new Date("2026-11-17T00:00:00Z"), expires_at: new Date("2026-11-18T00:00:00Z"), revoked_at: null },
      { id: "s2", token_id: "jti-old", created_at: new Date("2026-11-16T00:00:00Z"), expires_at: new Date("2026-11-17T00:00:00Z"), revoked_at: new Date() }
    ]);
    const response = await handleAccountRoute(jsonRequest("GET", "/api/v1/auth/sessions"), mailEnv, "r", d);
    const body = await readJson(response!);
    expect(body.data).toEqual([
      { id: "s1", created_at: "2026-11-17T00:00:00.000Z", expires_at: "2026-11-18T00:00:00.000Z", revoked: false, current: true },
      { id: "s2", created_at: "2026-11-16T00:00:00.000Z", expires_at: "2026-11-17T00:00:00.000Z", revoked: true, current: false }
    ]);
    expect(fake.queries[0].values).toContain("u1");
  });

  it("cannot revoke another account's session (404, scoped by user_id)", async () => {
    const { fake, d } = deps(() => []);
    const response = await handleAccountRoute(jsonRequest("DELETE", "/api/v1/auth/sessions/someone-elses"), mailEnv, "r", d);
    expect(response!.status).toBe(404);
    expect(fake.queries[0].text).toContain("WHERE id = $ AND user_id = $");
    expect(fake.queries[0].values).toEqual(["someone-elses", "u1"]);
  });

  it("reports MFA status from the caller's own rows", async () => {
    const { d } = deps(() => [{ enabled: true, remaining: "7" }]);
    const response = await handleAccountRoute(jsonRequest("GET", "/api/v1/auth/mfa/status"), mailEnv, "r", d);
    expect((await readJson(response!)).data).toEqual({ enabled: true, recovery_codes_remaining: 7 });
  });

  it("rejects MFA enable without a code", async () => {
    const { d } = deps(() => [{ id: "u1", email: "u1@x.test", password_hash: "h", mfa_enabled: false, mfa_secret_encrypted: "", mfa_last_used_step: null }]);
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/mfa/enable", { code: "1" }), mailEnv, "r", d);
    expect(response!.status).toBe(422);
  });

  it("asks for setup before enable", async () => {
    const { d } = deps(() => [{ id: "u1", email: "u1@x.test", password_hash: "h", mfa_enabled: false, mfa_secret_encrypted: "", mfa_last_used_step: null }]);
    const response = await handleAccountRoute(jsonRequest("POST", "/api/v1/auth/mfa/enable", { code: "123456" }), mailEnv, "r", d);
    expect(response!.status).toBe(400);
    expect((await readJson(response!)).message).toBe("Start MFA setup first.");
  });
});

describe("Resend account mailer", () => {
  it("posts a plain-text email with bearer auth and returns the provider id", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
    const result = await sendAccountEmail(mailEnv, { to: "a@x.test", subject: "Hi", text: "Body" }, fetchImpl as unknown as typeof fetch);
    expect(result.id).toBe("re_123");
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_placeholder");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["a@x.test"], subject: "Hi", text: "Body" });
  });

  it("does not leak the message body (which holds the link) in errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    await expect(
      sendAccountEmail(mailEnv, { to: "a@x.test", subject: "S", text: "secret-link-123" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 403: domain not verified");
    let message = "";
    try {
      await sendAccountEmail(mailEnv, { to: "a@x.test", subject: "S", text: "secret-link-123" }, fetchImpl as unknown as typeof fetch);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("secret-link-123");
  });
});
