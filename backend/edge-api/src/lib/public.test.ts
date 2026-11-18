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
