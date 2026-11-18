import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handlePublicRoute } from "./public-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

const env = {} as Env;

describe("public pricing", () => {
  it("shows active plans and says fees are not decided when no schedule is approved", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT code, name, description, price_minor")) return [{ code: "free", name: "Free", description: "", price_minor: "0", currency: "INR", billing_interval: "month", ai_daily_limit: 20, ai_monthly_limit: 300, features_json: '["A"]' }];
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: false }];
      return [];
    });
    const response = await handlePublicRoute(jsonRequest("GET", "/api/v1/public/pricing"), env, "r", { database: () => fake.sql });
    const json = await readJson(response!);
    expect(json.data).toEqual({
      plans: [{ code: "free", name: "Free", description: "", price_minor: 0, currency: "INR", billing_interval: "month", ai_daily_limit: 20, ai_monthly_limit: 300, features: ["A"] }],
      fees: { status: "not_decided" },
      payments_live: false,
      client_marketplace_open: false
    });
  });

  it("reports unavailable parts instead of failing before migrations", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [];
      throw new Error("relation does not exist");
    });
    const json = await readJson((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/pricing"), env, "r", { database: () => fake.sql }))!);
    expect(json.data).toMatchObject({ plans: null, fees: { status: "unavailable" }, payments_live: false });
  });

  it("only answers GET on its path and needs no login", async () => {
    const fake = createFakeSql(() => []);
    expect(await handlePublicRoute(jsonRequest("POST", "/api/v1/public/pricing", {}), env, "r", { database: () => fake.sql })).toBeNull();
    expect(await handlePublicRoute(jsonRequest("GET", "/api/v1/public/other"), env, "r", { database: () => fake.sql })).toBeNull();
  });
});

describe("public home", () => {
  it("returns real categories, live agents and counts; categories are closed while the marketplace is off", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT slug, name, enabled FROM project_categories")) return [{ slug: "website_development", name: "Website development", enabled: true }, { slug: "ui_ux_design", name: "UI/UX design", enabled: false }];
      if (text.startsWith("SELECT code, name, side, purpose, status FROM agent_definitions")) return [{ code: "C1", name: "Brief Builder", side: "client", purpose: "p", status: "live" }];
      if (text.includes("AS listings")) return [{ listings: 0, freelancers: 3, completed: 0 }];
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: false }];
      return [];
    });
    const json = await readJson((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/home"), env, "r", { database: () => fake.sql }))!);
    expect(json.data.categories).toEqual([{ slug: "website_development", name: "Website development", open: false }, { slug: "ui_ux_design", name: "UI/UX design", open: false }]);
    expect(json.data.agents).toHaveLength(1);
    expect(json.data.counts).toEqual({ published_projects: 0, visible_freelancers: 3, completed_contracts: 0 });
    expect(fake.queries.some((q) => /^(INSERT|UPDATE|DELETE)/.test(q.text))).toBe(false);
  });

  it("degrades to empty data before migrations", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [];
      throw new Error("relation does not exist");
    });
    const json = await readJson((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/home"), env, "r", { database: () => fake.sql }))!);
    expect(json.data).toEqual({ client_marketplace_open: false, categories: [], agents: [], counts: null });
  });
});

describe("public freelancers", () => {
  const row = { user_id: "f1", full_name: "Asha", headline: "Web developer", skills: '["React"]', services: "[]", minimum_budget: 5000, hourly_rate: 800, currency: "INR", weekly_hours: 20, timezone: "Asia/Kolkata", dealbreakers: '["crypto"]', user_created_at: new Date("2026-01-01"), rating_avg: 4.5, rating_count: 2, completed: 3 };

  it("lists only opted-in freelancers without private fields, and is closed while the marketplace is off", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
      if (text.includes("p.marketplace_visible = true")) return [row];
      return [];
    });
    const json = await readJson((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/freelancers?q=react"), env, "r", { database: () => fake.sql }))!);
    expect(json.data.items[0]).toMatchObject({ user_id: "f1", display_name: "Asha", completed_contracts: 3, rating: { average: 4.5, count: 2 } });
    expect(JSON.stringify(json.data)).not.toMatch(/dealbreaker|minimum_budget|email|crypto/);
    const closed = createFakeSql((text) => (text.startsWith("SELECT enabled FROM feature_flags") ? [{ enabled: false }] : [row]));
    expect((await readJson((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/freelancers"), env, "r", { database: () => closed.sql }))!)).data).toEqual({ open: false, items: [], more: false });
    expect((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/freelancers/f1"), env, "r", { database: () => closed.sql }))!.status).toBe(404);
  });

  it("returns a profile with revealed reviews, and 404 for hidden freelancers", async () => {
    const fake = createFakeSql((text, values) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
      if (text.includes("WHERE p.user_id =")) return values.includes("f1") ? [row] : [];
      if (text.startsWith("SELECT count(*)::int AS n FROM contracts")) return [{ n: 3 }];
      if (text.startsWith("SELECT rv.rating")) return [{ rating: 5, comment: "Great work", created_at: new Date("2026-11-01") }];
      return [];
    });
    const json = await readJson((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/freelancers/f1"), env, "r", { database: () => fake.sql }))!);
    expect(json.data.reviews).toEqual([{ rating: 5, comment: "Great work", created_at: "2026-11-01T00:00:00.000Z" }]);
    expect((await handlePublicRoute(jsonRequest("GET", "/api/v1/public/freelancers/hidden"), env, "r", { database: () => fake.sql }))!.status).toBe(404);
  });
});

