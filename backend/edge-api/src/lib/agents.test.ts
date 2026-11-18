import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { AGENT_FOR_OPERATION, agentEnabled, handleAgentRoute } from "./agents";
import type { AgentRouteDeps } from "./agents";
import { reserveAiCall } from "./ai-governor";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const AGENTS = [
  { code: "F4", name: "Proposal Agent", side: "freelancer", purpose: "Drafts proposals", autonomy_ceiling: "A2", human_gate: "Approval", tools_json: '["draft:D"]', runtime_names_json: '["proposal_agent","apply_agent"]', status: "live", enabled: true },
  { code: "C2", name: "Match and Shortlist Agent", side: "client", purpose: "Matches", autonomy_ceiling: "A1", human_gate: "Client decides", tools_json: "[]", runtime_names_json: '["match_shortlist"]', status: "live", enabled: true }
];

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function world(roles: string[] = ["freelancer"]) {
  const fake = createFakeSql((text, values) => {
    if (text.startsWith("SELECT * FROM agent_definitions")) return AGENTS;
    if (text.startsWith("SELECT role, status FROM user_roles")) return roles.map((role) => ({ role, status: "active" }));
    if (text.startsWith("SELECT id, agent_name, status, summary, created_at FROM agent_runs")) {
      return [{ id: "r1", agent_name: "apply_agent", status: "completed", summary: "Sent", created_at: new Date() }, { id: "r2", agent_name: "legacy_agent", status: "completed", summary: "x", created_at: new Date() }];
    }
    if (text.startsWith("UPDATE agent_definitions")) return values[2] === "F4" ? [{ ...AGENTS[0], enabled: values[0] }] : [];
    return [];
  });
  const deps: AgentRouteDeps = { database: () => fake.sql, authenticate: async () => session("u1") };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: AgentRouteDeps, method: string, path: string, payload?: unknown) => handleAgentRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("agent registry", () => {
  it("maps every AI model operation to a registered agent", () => {
    expect(AGENT_FOR_OPERATION).toEqual({ proposal_draft: "F4", reply_analysis: "F9", brief_builder: "C1", business_coach: "F11" });
  });

  it("treats unknown agents and a missing registry table as enabled", async () => {
    expect(await agentEnabled(createFakeSql(() => []).sql, "F4")).toBe(true);
    expect(await agentEnabled(createFakeSql(() => { throw new Error("no table"); }).sql, "F4")).toBe(true);
    expect(await agentEnabled(createFakeSql(() => [{ enabled: false }]).sql, "F4")).toBe(false);
    expect(await agentEnabled(createFakeSql(() => [{ enabled: false }]).sql, undefined)).toBe(true);
  });

  it("makes the governor refuse model calls for a disabled agent", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
      if (text.startsWith("SELECT enabled FROM agent_definitions")) return [{ enabled: false }];
      return [];
    });
    const decision = await reserveAiCall({ AI: {} } as unknown as Env, fake.sql, { userId: "u1", operation: "brief_builder", inputChars: 10, maxOutputTokens: 10 });
    expect(decision).toMatchObject({ allowed: false, reason: "disabled" });
    expect(fake.queries.some((q) => q.text.startsWith("INSERT INTO ai_usage_events"))).toBe(false);
  });

  it("lists the catalogue in both shapes and labels my runs with agent codes", async () => {
    const list = await readJson((await call(world().deps, "GET", "/api/v1/agents"))!);
    expect(list.data[0]).toMatchObject({ code: "F4", autonomy_ceiling: "A2", tools: ["draft:D"], enabled: true });
    expect(JSON.stringify(list.data)).not.toContain("runtime_names");
    const legacy = await readJson((await call(world().deps, "GET", "/api/v1/agents/registry"))!);
    expect(legacy.data[0]).toMatchObject({ name: "F4 Proposal Agent", status: "live", mode: "Drafts proposals" });
    const runs = await readJson((await call(world().deps, "GET", "/api/v1/me/agent-runs"))!);
    expect(runs.data.map((r: { agent_code: string | null }) => r.agent_code)).toEqual(["F4", null]);
    const filtered = world();
    await call(filtered.deps, "GET", "/api/v1/me/agent-runs?agent=F4");
    const query = filtered.fake.queries.find((q) => q.text.includes("FROM agent_runs"))!;
    expect(query.values).toEqual(["u1", ["proposal_agent", "apply_agent"]]);
    const unknown = await readJson((await call(world().deps, "GET", "/api/v1/me/agent-runs?agent=Z9"))!);
    expect(unknown.data).toEqual([]);
  });

  it("lets only admins switch an agent on or off", async () => {
    expect((await call(world(["freelancer"]).deps, "POST", "/api/v1/admin/agents/F4", { enabled: false }))!.status).toBe(404);
    expect((await call(world(["admin"]).deps, "POST", "/api/v1/admin/agents/F4", { enabled: "no" }))!.status).toBe(422);
    const off = await call(world(["admin"]).deps, "POST", "/api/v1/admin/agents/F4", { enabled: false });
    expect((await readJson(off!)).data.enabled).toBe(false);
    expect((await call(world(["admin"]).deps, "POST", "/api/v1/admin/agents/X9", { enabled: false }))!.status).toBe(404);
  });
});
