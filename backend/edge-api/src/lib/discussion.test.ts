import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleDiscussionRoute, interviewAllowed, meetingLinkOk, mergeThreads, validateInterview } from "./discussion-routes";
import type { DiscussionRouteDeps, InboxThread } from "./discussion-routes";
import { createFakeSql, jsonRequest } from "./test-support";

const NOW = new Date("2026-11-18T10:00:00Z");

describe("meeting links", () => {
  it("accepts https links on known meeting services only", () => {
    expect(meetingLinkOk("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(meetingLinkOk("https://us02web.zoom.us/j/123")).toBe(true);
    expect(meetingLinkOk("https://teams.microsoft.com/l/meetup-join/x")).toBe(true);
    expect(meetingLinkOk("http://meet.google.com/abc")).toBe(false);
    expect(meetingLinkOk("https://zoom.us.evil.test/j/1")).toBe(false);
    expect(meetingLinkOk("https://user:pw@meet.jit.si/room")).toBe(false);
    expect(meetingLinkOk("javascript:alert(1)")).toBe(false);
  });
});

describe("interview validation", () => {
  it("needs a time 30 minutes to 90 days ahead and sane fields", () => {
    expect(validateInterview({ starts_at: "2026-11-18T10:10:00Z" }, NOW)).toMatchObject({ ok: false, errors: { starts_at: "Choose a time at least 30 minutes from now." } });
    expect(validateInterview({ starts_at: "2027-03-01T10:00:00Z" }, NOW)).toMatchObject({ ok: false, errors: { starts_at: "Choose a time within the next 90 days." } });
    expect(validateInterview({ starts_at: "nope" }, NOW)).toMatchObject({ ok: false });
    const bad = validateInterview({ starts_at: "2026-11-20T10:00:00Z", duration_minutes: 5, mode: "fax", meeting_link: "https://evil.test/x", agenda: "call me on +91 98765 43210" }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["agenda", "duration_minutes", "meeting_link", "mode"]);
    expect(validateInterview({ starts_at: "2026-11-20T10:00:00Z", meeting_link: "https://meet.google.com/x" }, NOW)).toEqual({
      ok: true,
      value: { starts_at: "2026-11-20T10:00:00.000Z", duration_minutes: 30, mode: "video", meeting_link: "https://meet.google.com/x", agenda: "" }
    });
  });
});

describe("interview permissions", () => {
  const future = "2026-11-20T10:00:00Z";
  const past = "2026-11-18T09:00:00Z";
  const client = { party: "client" as const, canManage: true };
  const member = { party: "client" as const, canManage: false };
  const freelancer = { party: "freelancer" as const, canManage: true };

  it("lets only the other side answer, before the time", () => {
    expect(interviewAllowed("accept", { status: "proposed", proposed_party: "client", starts_at: future }, freelancer, NOW)).toEqual({ ok: true });
    expect(interviewAllowed("accept", { status: "proposed", proposed_party: "client", starts_at: future }, client, NOW)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(interviewAllowed("decline", { status: "accepted", proposed_party: "client", starts_at: future }, freelancer, NOW)).toMatchObject({ ok: false, code: "INTERVIEW_CLOSED" });
    expect(interviewAllowed("accept", { status: "proposed", proposed_party: "freelancer", starts_at: past }, client, NOW)).toMatchObject({ ok: false, code: "INTERVIEW_PASSED" });
    expect(interviewAllowed("accept", { status: "proposed", proposed_party: "freelancer", starts_at: future }, member, NOW)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("cancels before the start and completes only after, client side", () => {
    expect(interviewAllowed("cancel", { status: "accepted", proposed_party: "client", starts_at: future }, freelancer, NOW)).toEqual({ ok: true });
    expect(interviewAllowed("cancel", { status: "accepted", proposed_party: "client", starts_at: past }, freelancer, NOW)).toMatchObject({ code: "INTERVIEW_PASSED" });
    expect(interviewAllowed("complete", { status: "accepted", proposed_party: "client", starts_at: past }, client, NOW)).toEqual({ ok: true });
    expect(interviewAllowed("complete", { status: "accepted", proposed_party: "client", starts_at: past }, freelancer, NOW)).toMatchObject({ code: "FORBIDDEN" });
    expect(interviewAllowed("complete", { status: "accepted", proposed_party: "client", starts_at: future }, client, NOW)).toMatchObject({ code: "INTERVIEW_NOT_STARTED" });
    expect(interviewAllowed("complete", { status: "proposed", proposed_party: "client", starts_at: past }, client, NOW)).toMatchObject({ code: "INTERVIEW_CLOSED" });
  });
});

describe("inbox merge", () => {
  const t = (kind: InboxThread["kind"], id: string, at: string, title = "Site"): InboxThread => ({ kind, id, title, last_message: "hi", last_at: at, from_other_side: true, href: "/" });
  it("sorts newest first across kinds and filters by text", () => {
    const merged = mergeThreads([[t("contract", "c", "2026-11-17T00:00:00.000Z")], [t("proposal", "p", "2026-11-18T00:00:00.000Z", "Bakery")], [t("external", "e", "2026-11-16T00:00:00.000Z")]], "");
    expect(merged.map((m) => m.id)).toEqual(["p", "c", "e"]);
    expect(mergeThreads([[t("contract", "c", "2026-11-17T00:00:00.000Z")], [t("proposal", "p", "2026-11-18T00:00:00.000Z", "Bakery")]], "bakery").map((m) => m.id)).toEqual(["p"]);
  });
});

describe("discussion routes", () => {
  const env = {} as Env;
  const deps = (rows: (q: string) => unknown[]): DiscussionRouteDeps => ({
    database: () => createFakeSql((q) => rows(q)).sql,
    authenticate: async () => ({ user: { id: "f1", email: "f1@x.test", email_verified: true, mfa_enabled: false }, claims: { sub: "f1", jti: "j", iat: 0, exp: 0 } }) as never,
    now: () => NOW
  });

  it("ignores unrelated paths, including the hiring routes", async () => {
    expect(await handleDiscussionRoute(jsonRequest("POST", "/api/v1/listing-proposals/P1/withdraw", {}), env, "r", deps(() => []))).toBeNull();
    expect(await handleDiscussionRoute(jsonRequest("POST", "/api/v1/listing-proposals/P1/discussion", {}), env, "r", deps(() => []))).toBeNull();
  });

  it("returns 503 before migration 0070", async () => {
    const res = await handleDiscussionRoute(jsonRequest("POST", "/api/v1/listing-proposals/P1/messages", { body: "hi" }), env, "r",
      deps((q) => (q.includes("feature_flags") ? [{ enabled: true }] : q.includes("to_regclass") ? [{ ready: false }] : [])));
    expect(res?.status).toBe(503);
  });
});

describe("text array parameters", () => {
  it("quotes and escapes every element so Postgres reads a literal text[]", async () => {
    const { textArray } = await import("./core-routes");
    expect(textArray([])).toBe("{}");
    expect(textArray(["o1", "o2"])).toBe('{"o1","o2"}');
    expect(textArray(['a"b,c\\', "NULL"])).toBe('{"a\\"b,c\\\\","NULL"}');
  });
});
