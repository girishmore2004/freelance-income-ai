import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  applySessionCookies,
  csrfViolation,
  parseCookies,
  readSessionToken
} from "./auth-context";
import { success } from "./response";
import { jsonRequest, readJson } from "./test-support";

const env = { CORS_ORIGINS: "https://app.example.test" } as unknown as Env;
const CSRF = "c".repeat(43);

describe("session transport", () => {
  it("parses cookies and prefers the HttpOnly session cookie over a bearer header", () => {
    expect(parseCookies("a=1; b=x%20y; a=2")).toEqual({ a: "1", b: "x y" });
    const request = jsonRequest("GET", "/api/v1/me", undefined, {
      Cookie: `${SESSION_COOKIE}=jwt-from-cookie`,
      Authorization: "Bearer jwt-from-header"
    });
    expect(readSessionToken(request, env)).toEqual({ token: "jwt-from-cookie", via: "cookie" });
  });

  it("accepts bearer tokens unless AUTH_ALLOW_BEARER is false", () => {
    const request = jsonRequest("GET", "/api/v1/me", undefined, { Authorization: "Bearer abc" });
    expect(readSessionToken(request, env)).toEqual({ token: "abc", via: "bearer" });
    expect(readSessionToken(request, { ...env, AUTH_ALLOW_BEARER: "false" } as Env)).toBeNull();
  });
});

describe("CSRF protection for cookie sessions", () => {
  const cookie = `${SESSION_COOKIE}=jwt; ${CSRF_COOKIE}=${CSRF}`;

  it("lets safe methods through", () => {
    expect(csrfViolation(jsonRequest("GET", "/api/v1/profile", undefined, { Cookie: cookie }), env, "r")).toBeNull();
  });

  it("requires a matching header on unsafe methods", async () => {
    const missing = csrfViolation(jsonRequest("POST", "/api/v1/proposals", {}, { Cookie: cookie }), env, "r");
    expect(missing?.status).toBe(403);
    expect((await readJson(missing!)).error?.code).toBe("CSRF_TOKEN_INVALID");

    const wrong = csrfViolation(jsonRequest("POST", "/api/v1/proposals", {}, { Cookie: cookie, "X-CSRF-Token": "d".repeat(43) }), env, "r");
    expect(wrong?.status).toBe(403);

    const ok = csrfViolation(jsonRequest("POST", "/api/v1/proposals", {}, { Cookie: cookie, "X-CSRF-Token": CSRF }), env, "r");
    expect(ok).toBeNull();
  });

  it("rejects a foreign Origin even with a valid token", async () => {
    const response = csrfViolation(
      jsonRequest("DELETE", "/api/v1/auth/sessions/x", undefined, { Cookie: cookie, "X-CSRF-Token": CSRF, Origin: "https://evil.example" }),
      env,
      "r"
    );
    expect(response?.status).toBe(403);
    expect((await readJson(response!)).error?.code).toBe("CSRF_ORIGIN_REJECTED");
  });

  it("accepts the configured frontend origin and same-origin requests", () => {
    const fromApp = jsonRequest("POST", "/x", {}, { Cookie: cookie, "X-CSRF-Token": CSRF, Origin: "https://app.example.test" });
    const sameOrigin = jsonRequest("POST", "/x", {}, { Cookie: cookie, "X-CSRF-Token": CSRF, Origin: "https://api.example.test" });
    expect(csrfViolation(fromApp, env, "r")).toBeNull();
    expect(csrfViolation(sameOrigin, env, "r")).toBeNull();
  });
});

describe("cookie-mode login responses", () => {
  const loginResponse = () =>
    success({ status: "authenticated", access_token: "jwt-123", token_type: "bearer", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, "ok");

  it("moves the token into HttpOnly cookies and removes it from the body", async () => {
    const request = jsonRequest("POST", "/api/v1/auth/login", {}, { "X-Session-Mode": "cookie" });
    const response = await applySessionCookies(request, loginResponse(), env);
    const body = await readJson(response);
    expect(body.data.access_token).toBeUndefined();
    expect(body.data.session_mode).toBe("cookie");
    expect(JSON.stringify(body)).not.toContain("jwt-123");

    const cookies = response.headers.get("Set-Cookie") ?? "";
    expect(cookies).toContain(`${SESSION_COOKIE}=jwt-123`);
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("SameSite=Lax");
    expect(cookies).toContain(`${CSRF_COOKIE}=`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves bearer-mode clients unchanged", async () => {
    const request = jsonRequest("POST", "/api/v1/auth/login", {});
    const response = await applySessionCookies(request, loginResponse(), env);
    expect((await readJson(response)).data.access_token).toBe("jwt-123");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("clears cookies on logout", async () => {
    const request = jsonRequest("POST", "/api/v1/auth/logout", {});
    const response = await applySessionCookies(request, success({ status: "logged_out" }), env);
    expect(response.headers.get("Set-Cookie") ?? "").toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  });
});
