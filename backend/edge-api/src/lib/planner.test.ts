import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { calendarWindow, handlePlannerRoute, milestoneEvents, sortEvents } from "./planner-routes";
import type { PlannerRouteDeps } from "./planner-routes";
import { handleSupportRoute, validateTicket } from "./support-routes";
import type { SupportRouteDeps } from "./support-routes";
import { rateKey } from "./rate-limit";
import { suspensionBlocks } from "./auth-context";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

const NOW = new Date("2026-11-18T10:00:00Z");
const session = (id: string) => ({ user: { id, email: `${id}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: id, jti: "j", iat: 0, exp: 0 } });
const anonymous = async () => new Response("{}", { status: 401 });

describe("calendar helpers", () => {
  it("validates the window", () => {
    expect(calendarWindow(null, null, NOW)).toEqual({ from: "2026-11-18", to: "2026-12-29" });
    expect(calendarWindow("2026-12-01", "7", NOW)).toEqual({ from: "2026-12-01", to: "2026-12-07" });
    expect(calendarWindow("2026-02-30", "7", NOW)).toBeNull();
    expect(calendarWindow("2026-12-01", "93", NOW)).toBeNull();
    expect(calendarWindow("2026-12-01", "0", NOW)).toBeNull();
  });

  it("lists unapproved milestones in the window and keeps overdue ones from before it", () => {
    const contracts = [{
      id: "K1", title: "Cafe site", side: "freelancer" as const,
      milestones_json: JSON.stringify([
        { title: "Design", due_date: "2026-11-10" },
        { title: "Build", due_date: "2026-11-25" },
        { title: "Launch", due_date: "2027-03-01" },
        { title: "Approved", due_date: "2026-11-20" },
        { title: "No date", due_date: null },
        { title: "Bad", due_date: "2026-13-01" }
      ])
    }];
    const events = milestoneEvents(contracts, new Set(["K1:3"]), { from: "2026-11-18", to: "2026-12-29" }, "2026-11-18");
    expect(events.map((e) => [e.title, e.overdue])).toEqual([["Cafe site: Design", true], ["Cafe site: Build", false]]);
    expect(milestoneEvents([{ id: "K2", title: "x", side: "client", milestones_json: "not json" }], new Set(), { from: "2026-11-18", to: "2026-12-29" }, "2026-11-18")).toEqual([]);
  });

  it("sorts by date, then type, then title", () => {
    const base = { detail: "", href: "", overdue: false, side: null };
    const sorted = sortEvents([
      { ...base, date: "2026-11-20", type: "saved_closes", title: "B" },
      { ...base, date: "2026-11-19", type: "milestone_due", title: "A" },
      { ...base, date: "2026-11-20", type: "listing_closes", title: "C" }
    ]);
    expect(sorted.map((e) => e.title)).toEqual(["A", "C", "B"]);
  });
});

function plannerWorld(opts: { flag?: boolean; visible?: boolean; count?: number; upsert?: boolean } = {}) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: opts.flag ?? true }];
    if (text.startsWith("SELECT l.id FROM project_listings l JOIN organizations")) return opts.visible === false ? [] : [{ id: "L1" }];
    if (text.startsWith("SELECT count(*)::int AS n FROM saved_listings")) return [{ n: opts.count ?? 0 }];
    if (text.startsWith("INSERT INTO saved_listings")) return opts.upsert === false ? [] : [{ listing_id: "L1", note: "later" }];
    if (text.startsWith("SELECT organization_id FROM organization_memberships")) return [{ organization_id: "o1" }];
    if (text.includes("FROM contracts c JOIN contract_versions v")) {
      return [{ id: "K1", title: "Cafe site", side: "client", milestones_json: JSON.stringify([{ title: "Design", due_date: "2026-11-20" }]) }];
    }
    if (text.startsWith("SELECT l.id, v.title, l.closes_at, v.deadline, l.status FROM saved_listings")) return [{ id: "L2", title: "Logo", closes_at: new Date("2026-11-30T00:00:00Z"), deadline: "2027-02-01", status: "published" }];
    if (text.startsWith("SELECT l.id, v.title, l.closes_at, v.deadline, l.status FROM project_listings")) return [{ id: "L3", title: "Menu app", closes_at: null, deadline: "2026-12-10", status: "hiring" }];
    return [];
  });
  const deps: PlannerRouteDeps = { database: () => fake.sql, authenticate: async () => session("f1"), now: () => NOW };
  return { fake, deps };
}
const call = (deps: PlannerRouteDeps, method: string, path: string, payload?: unknown) => handlePlannerRoute(jsonRequest(method, path, payload), {} as Env, "r", deps);

describe("saved projects and calendar routes", () => {
  it("saves visible projects only, with a screened note and a limit", async () => {
    expect((await call(plannerWorld().deps, "POST", "/api/v1/marketplace/listings/L1/save", { note: "later" }))!.status).toBe(200);
    expect((await call(plannerWorld({ visible: false }).deps, "POST", "/api/v1/marketplace/listings/L1/save", {}))!.status).toBe(404);
    expect((await call(plannerWorld().deps, "POST", "/api/v1/marketplace/listings/L1/save", { note: "call me on WhatsApp" }))!.status).toBe(422);
    expect((await call(plannerWorld({ count: 200, upsert: false }).deps, "POST", "/api/v1/marketplace/listings/L1/save", {}))!.status).toBe(409);
    expect((await call(plannerWorld({ flag: false }).deps, "GET", "/api/v1/me/saved-listings"))!.status).toBe(403);
  });

  it("unsaving touches only the caller's row", async () => {
    const { deps, fake } = plannerWorld();
    await call(deps, "DELETE", "/api/v1/marketplace/listings/L1/save");
    const del = fake.queries.find((q) => q.text.startsWith("DELETE FROM saved_listings"))!;
    expect(del.values).toEqual(["f1", "L1"]);
  });

  it("builds the calendar from the caller's contracts, saved projects and posted projects, even with the marketplace flag off", async () => {
    const { deps } = plannerWorld({ flag: false });
    const response = await call(deps, "GET", "/api/v1/me/calendar?days=42");
    expect(response!.status).toBe(200);
    const data = (await readJson(response!)).data;
    expect(data.events.map((e: { type: string; date: string }) => `${e.date} ${e.type}`)).toEqual([
      "2026-11-20 milestone_due", "2026-11-30 saved_closes", "2026-12-10 listing_deadline"
    ]);
    expect((await call(deps, "GET", "/api/v1/me/calendar?from=bad"))!.status).toBe(422);
  });
});

describe("support tickets", () => {
  it("validates topic, length and email (required for visitors only)", () => {
    const ok = { topic: "payments", subject: "Refund question", body: "How long does a test refund take to show up?" };
    expect(validateTicket(ok, true).ok).toBe(true);
    const visitor = validateTicket(ok, false);
    expect(visitor.ok).toBe(false);
    expect(validateTicket({ ...ok, email: "Asha@Example.com" }, false)).toEqual({ ok: true, value: { ...ok, email: "asha@example.com", name: "" } });
    const bad = validateTicket({ topic: "sales", subject: "x", body: "short", email: "nope" }, true);
    expect(bad.ok ? [] : Object.keys(bad.errors).sort()).toEqual(["body", "email", "subject", "topic"]);
  });

  function supportWorld(opts: { user?: string | null; roles?: string[]; open?: number; resolved?: boolean } = {}) {
    const fake = createFakeSql((text, values) => {
      if (text.startsWith("SELECT count(*)::int AS n FROM support_tickets")) return [{ n: opts.open ?? 0 }];
      if (text.startsWith("INSERT INTO support_tickets")) return [{ id: "T1", user_id: values[1], email: values[2], name: values[3], topic: values[4], subject: values[5], body: values[6], status: "open", resolution_note: "", resolved_at: null, created_at: NOW }];
      if (text.startsWith("SELECT role, status FROM user_roles")) return (opts.roles ?? []).map((role) => ({ role, status: "active" }));
      if (text.startsWith("UPDATE support_tickets")) return opts.resolved === false ? [] : [{ id: "T1", user_id: "u9", email: "", name: "", topic: "other", subject: "Help", body: "b", status: "resolved", resolution_note: values[0], resolved_at: NOW, created_at: NOW }];
      return [];
    });
    const deps: SupportRouteDeps = {
      database: () => fake.sql,
      authenticate: opts.user === null || opts.user === undefined ? anonymous : async () => session(opts.user as string)
    };
    return { fake, deps };
  }
  const post = (deps: SupportRouteDeps, path: string, payload: unknown, method = "POST") => handleSupportRoute(jsonRequest(method, path, payload), {} as Env, "r", deps);
  const TICKET = { topic: "account", subject: "Cannot sign in", body: "I reset my password but still cannot sign in today." };

  it("accepts visitor messages with an email, links signed-in senders, and limits open tickets", async () => {
    const visitor = supportWorld();
    expect((await post(visitor.deps, "/api/v1/support/tickets", TICKET))!.status).toBe(422);
    expect((await post(visitor.deps, "/api/v1/support/tickets", { ...TICKET, email: "v@x.test" }))!.status).toBe(201);
    const signed = supportWorld({ user: "u1" });
    await post(signed.deps, "/api/v1/support/tickets", TICKET);
    const insert = signed.fake.queries.find((q) => q.text.startsWith("INSERT INTO support_tickets"))!;
    expect(insert.values.slice(1, 3)).toEqual(["u1", "u1@x.test"]);
    expect((await post(supportWorld({ user: "u1", open: 5 }).deps, "/api/v1/support/tickets", TICKET))!.status).toBe(429);
  });

  it("stores nothing when the honeypot is filled", async () => {
    const { deps, fake } = supportWorld();
    expect((await post(deps, "/api/v1/support/tickets", { ...TICKET, email: "v@x.test", website: "http://spam" }))!.status).toBe(201);
    expect(fake.queries.some((q) => q.text.startsWith("INSERT"))).toBe(false);
  });

  it("keeps the staff queue to admins and moderators; resolving is logged and notifies the sender", async () => {
    expect((await handleSupportRoute(jsonRequest("GET", "/api/v1/admin/support/tickets"), {} as Env, "r", supportWorld({ user: "u1" }).deps))!.status).toBe(404);
    expect((await handleSupportRoute(jsonRequest("GET", "/api/v1/admin/support/tickets"), {} as Env, "r", supportWorld().deps))!.status).toBe(401);
    const staff = supportWorld({ user: "m1", roles: ["moderator"] });
    expect((await post(staff.deps, "/api/v1/admin/support/tickets/T1/resolve", { note: "x" }))!.status).toBe(422);
    expect((await post(staff.deps, "/api/v1/admin/support/tickets/T1/resolve", { note: "Password reset link resent." }))!.status).toBe(200);
    const writes = staff.fake.queries.filter((q) => q.inTransaction).map((q) => q.text.split(" ").slice(0, 3).join(" "));
    expect(writes).toEqual(["UPDATE support_tickets SET", "INSERT INTO moderation_actions"]);
    expect(staff.fake.queries.some((q) => q.text.startsWith("INSERT INTO notifications"))).toBe(true);
    expect((await post(supportWorld({ user: "m1", roles: ["moderator"], resolved: false }).deps, "/api/v1/admin/support/tickets/T1/resolve", { note: "Done already." }))!.status).toBe(409);
  });

  it("uses the strict per-IP limiter for the public form and lets suspended users write to support", async () => {
    const req = new Request("https://x/api/v1/support/tickets", { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } });
    expect(await rateKey(req, {} as Env)).toEqual({ limiter: "auth", key: "support:1.2.3.4" });
    expect(suspensionBlocks("POST", "/api/v1/support/tickets")).toBe(false);
  });
});
