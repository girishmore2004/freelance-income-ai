import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { expireStaleOpportunities, handleAgentCompleteRoute, isoWeek, recordTrustSignal } from "./agent-complete-routes";
import { capacityPlan, profileReview, signalKind, spendForecast } from "./agent-complete";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

const env = {} as Env;
const as = (fake: ReturnType<typeof createFakeSql>, id = "u1") => ({
  database: () => fake.sql,
  authenticate: async () => ({ user: { id, email: "", email_verified: true, mfa_enabled: false }, claims: { sub: id, jti: "j", iat: 0, exp: 0 } }),
  now: () => new Date("2026-11-19T10:00:00Z")
});

describe("completed agents: routes", () => {
  it("answer only their own paths", async () => {
    const fake = createFakeSql(() => []);
    expect(await handleAgentCompleteRoute(jsonRequest("GET", "/api/v1/me/profile"), env, "r", as(fake))).toBeNull();
    expect(await handleAgentCompleteRoute(jsonRequest("DELETE", "/api/v1/me/capacity"), env, "r", as(fake))).toBeNull();
  });

  it("keep staff views from everyone else (404, as for other admin pages)", async () => {
    const fake = createFakeSql((text) => (text.startsWith("SELECT role, status FROM user_roles") ? [{ role: "freelancer", status: "active" }] : []));
    for (const p of ["/api/v1/admin/risk-signals", "/api/v1/admin/balance-alerts", "/api/v1/admin/source-takedowns"]) {
      expect((await handleAgentCompleteRoute(jsonRequest("GET", p), env, "r", as(fake)))!.status).toBe(404);
    }
    const terms = await handleAgentCompleteRoute(jsonRequest("POST", "/api/v1/admin/sources/remotive/terms", {}), env, "r", as(fake));
    expect(terms!.status).toBe(403);
  });

  it("let people switch groups off, never the account and safety group", async () => {
    const fake = createFakeSql((text) => (text.includes("to_regclass") ? [{ ready: true }] : []));
    const bad = await handleAgentCompleteRoute(jsonRequest("PUT", "/api/v1/me/notification-settings", { groups: { account: false } }), env, "r", as(fake));
    expect(bad!.status).toBe(422);
    const ok = await handleAgentCompleteRoute(jsonRequest("PUT", "/api/v1/me/notification-settings", { groups: { alerts: false } }), env, "r", as(fake));
    expect(ok!.status).toBe(200);
    const write = fake.queries.find((q) => q.text.startsWith("INSERT INTO notification_preferences"))!;
    expect(write.values).toEqual(["u1", "alerts", false]);
    const body = await readJson(ok!);
    expect(body.data.groups.find((g: { key: string }) => g.key === "account")).toMatchObject({ mutable: false, in_app: true });
  });

  it("hide another account's spend forecast", async () => {
    const fake = createFakeSql(() => []);
    expect((await handleAgentCompleteRoute(jsonRequest("GET", "/api/v1/analytics/client/forecast?organization_id=O9"), env, "r", as(fake)))!.status).toBe(404);
  });
});

describe("completed agents: helpers", () => {
  it("record a refused message as a trust signal and never throw", async () => {
    const fake = createFakeSql(() => []);
    await recordTrustSignal(fake.sql, "u1", ["off_platform_contact"], { type: "proposal", id: "P1", organization_id: "O1" });
    expect(fake.queries.find((q) => q.text.startsWith("INSERT INTO trust_signals"))!.values.slice(1, 5)).toEqual(["u1", "contact_attempt", "proposal", "P1"]);
    const broken = createFakeSql(() => { throw new Error("no table"); });
    await expect(recordTrustSignal(broken.sql, "u1", ["upfront_fee"], { type: "contract", id: "K1" })).resolves.toBeUndefined();
    expect(signalKind(["prohibited_work"])).toBeNull();
  });

  it("hide only open, old, unseen external jobs and leave a note", async () => {
    const fake = createFakeSql((text) => (text.startsWith("UPDATE opportunities") ? [{ id: "o1", user_id: "u1" }] : text.includes("to_regclass") ? [{ ready: true }] : []));
    expect(await expireStaleOpportunities(fake.sql, new Date("2026-11-19T00:00:00Z"))).toBe(1);
    const update = fake.queries.find((q) => q.text.startsWith("UPDATE opportunities"))!;
    expect(update.text).toContain("status = 'new'");
    expect(update.values).toEqual(["2026-10-29T00:00:00.000Z", "2026-11-12T00:00:00.000Z"]);
    expect(fake.queries.some((q) => q.text.startsWith("INSERT INTO opportunity_events"))).toBe(true);
  });

  it("label ISO weeks for the weekly digest", () => {
    expect(isoWeek(new Date("2026-11-19T00:00:00Z"))).toBe("2026-W47");
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });

  it("plan capacity and forecast spend without inventing hours or fees", () => {
    expect(capacityPlan({ weekly_hours: 0, hourly: [], due: [] }, "2026-11-19").status).toBe("unknown");
    expect(spendForecast([{ contract_id: "k", title: "S", milestone: "M", amount_minor: 1000, due_date: null, state: "unfunded" }], [], null, "2026-11-19").remaining_fixed_fee_minor).toBe(0);
    expect(profileReview({ headline: "Next.js developer for small shops", bio: "x".repeat(90), skills: [], portfolio_links: ["https://x.dev"], projects: [], completed_contracts: 0, reviews: 0, hourly_rate: 1000 }).score).toBe(100);
  });
});
