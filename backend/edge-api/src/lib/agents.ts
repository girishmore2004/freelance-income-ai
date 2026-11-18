import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles } from "./identity";

/**
 * Governed agent registry (Phase 6 batch 1; table `agent_definitions`,
 * migration 0058).
 *
 *   GET  /api/v1/agents                      the catalogue: purpose, autonomy ceiling, human gate, status, enabled
 *   GET  /api/v1/agents/registry             same catalogue in the older dashboard shape ({name, status, mode, ...})
 *   GET  /api/v1/me/agent-runs?agent=CODE     my recent agent runs (last 50), labelled with agent codes
 *   GET  /api/v1/me/agent-usage               per agent: my runs (total, failed) and AI model calls today / this month; pending approvals
 *   POST /api/v1/admin/agents/{code} {enabled}   admin kill switch for one agent
 *
 * The AI governor maps each model operation to its agent and refuses the call
 * while that agent is disabled (see `AGENT_FOR_OPERATION`).
 */

/** Which registry agent owns each AI model operation. */
export const AGENT_FOR_OPERATION: Record<string, string> = {
  proposal_draft: "F4",
  reply_analysis: "F9",
  brief_builder: "C1",
  business_coach: "F11"
};

/**
 * Governance policy per AI operation (Master Plan §8 agent standard): the
 * owning agent, the role the caller must hold, the registry tool the call
 * uses, and the autonomy level the call needs. The governor refuses the call
 * when the agent is off, not built, lacks the tool, or its ceiling is lower.
 */
export interface OperationPolicy {
  agent: string;
  role: "freelancer" | "client" | "any";
  tool: string;
  autonomy: "A0" | "A1" | "A2" | "A3";
}

export const OPERATION_POLICY: Record<string, OperationPolicy> = {
  proposal_draft: { agent: "F4", role: "freelancer", tool: "draft", autonomy: "A2" },
  reply_analysis: { agent: "F9", role: "freelancer", tool: "draft", autonomy: "A2" },
  brief_builder: { agent: "C1", role: "client", tool: "draft", autonomy: "A2" },
  business_coach: { agent: "F11", role: "any", tool: "analytics", autonomy: "A1" }
};

export interface AgentPolicyRow {
  enabled: boolean;
  status: string;
  autonomy_ceiling: string;
  tools_json: unknown;
}

const LEVEL: Record<string, number> = { A0: 0, A1: 1, A2: 2, A3: 3 };

/**
 * Decides whether an AI call may run. `agent` null = registry not migrated
 * (allowed, as before 0058); `roles` null = roles unavailable, and an empty
 * list = a legacy account from before roles existed (treated as freelancer).
 */
export function policyDecision(policy: OperationPolicy | undefined, agent: AgentPolicyRow | null, roles: string[] | null): { allowed: true } | { allowed: false; message: string } {
  if (!policy) return { allowed: true };
  if (agent) {
    if (!agent.enabled) return { allowed: false, message: "This AI agent is switched off by the platform. A template was used instead." };
    // Older registries (or partial rows) without status/ceiling/tools: only the switch applies.
    if (typeof agent.status !== "string") return policyRoles(policy, roles);
    if (agent.status === "planned" || agent.status === "blocked") return { allowed: false, message: "This AI agent is not available yet. A template was used instead." };
    if ((LEVEL[policy.autonomy] ?? 9) > (LEVEL[agent.autonomy_ceiling] ?? -1)) {
      return { allowed: false, message: "This AI action needs more autonomy than the agent is allowed. A template was used instead." };
    }
    let tools: string[] = [];
    try {
      const raw = typeof agent.tools_json === "string" ? JSON.parse(agent.tools_json) : agent.tools_json;
      tools = Array.isArray(raw) ? raw.map((t) => String(t).split(":")[0]) : [];
    } catch {
      tools = [];
    }
    if (!tools.includes(policy.tool)) return { allowed: false, message: "This AI agent is not allowed to use that tool. A template was used instead." };
  }
  return policyRoles(policy, roles);
}

function policyRoles(policy: OperationPolicy, roles: string[] | null): { allowed: true } | { allowed: false; message: string } {
  if (roles !== null && policy.role !== "any") {
    const effective = roles.length ? roles : ["freelancer"];
    if (!effective.includes(policy.role)) {
      return { allowed: false, message: `Turn on the ${policy.role} role to use this AI agent. A template was used instead.` };
    }
  }
  return { allowed: true };
}

/** Registry row for an agent; null if the registry table or row is missing. */
export async function agentPolicyRow(sql: Queryable, code: string): Promise<AgentPolicyRow | null> {
  try {
    const rows = await sql<AgentPolicyRow[]>`SELECT enabled, status, autonomy_ceiling, tools_json FROM agent_definitions WHERE code = ${code} LIMIT 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** True unless the agent is registered and switched off. Missing table (pre-0058) = enabled. */
export async function agentEnabled(sql: Queryable, code: string | undefined): Promise<boolean> {
  if (!code) return true;
  try {
    const rows = await sql<{ enabled: boolean }[]>`SELECT enabled FROM agent_definitions WHERE code = ${code} LIMIT 1`;
    return rows.length ? Boolean(rows[0].enabled) : true;
  } catch (error) {
    console.warn(JSON.stringify({ event: "agent.registry_unavailable", code, error_message: error instanceof Error ? error.message : "unknown" }));
    return true;
  }
}

interface AgentRow {
  code: string;
  name: string;
  side: string;
  purpose: string;
  autonomy_ceiling: string;
  human_gate: string;
  tools_json: string;
  runtime_names_json: string;
  status: string;
  enabled: boolean;
}

function list(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function agentOut(a: AgentRow) {
  return {
    code: a.code,
    name: a.name,
    side: a.side,
    purpose: a.purpose,
    autonomy_ceiling: a.autonomy_ceiling,
    human_gate: a.human_gate,
    tools: list(a.tools_json),
    status: a.status,
    enabled: Boolean(a.enabled)
  };
}

export interface AgentRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: AgentRouteDeps = { database, authenticate: authenticateRequest };

export async function handleAgentRoute(request: Request, env: Env, requestId: string, deps: AgentRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const toggle = path.match(/^\/api\/v1\/admin\/agents\/([A-Z]\d{1,2})$/);
  const known =
    (method === "GET" && (path === "/api/v1/agents" || path === "/api/v1/agents/registry" || path === "/api/v1/me/agent-runs" || path === "/api/v1/me/agent-usage")) ||
    (method === "POST" && toggle !== null);
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    const agents = await sql<AgentRow[]>`SELECT * FROM agent_definitions ORDER BY CASE side WHEN 'freelancer' THEN 1 WHEN 'client' THEN 2 ELSE 3 END, length(code), code`;

    if (path === "/api/v1/agents") {
      return success(agents.map(agentOut), "Agents", 200, requestId);
    }
    if (path === "/api/v1/agents/registry") {
      // Shape used by the existing dashboard (name/status/mode), plus the registry fields.
      return success(agents.map((a) => ({ ...agentOut(a), name: `${a.code} ${a.name}`, mode: a.purpose })), "Agent registry", 200, requestId);
    }

    if (path === "/api/v1/me/agent-runs") {
      const byName = new Map<string, string>();
      for (const a of agents) for (const name of list(a.runtime_names_json)) byName.set(name, a.code);
      const filter = url.searchParams.get("agent");
      const names = filter ? [...byName.entries()].filter(([, code]) => code === filter).map(([name]) => name) : [];
      if (filter && names.length === 0) return success([], "Agent runs", 200, requestId);
      const rows = filter
        ? await sql<{ id: string; agent_name: string; status: string; summary: string; created_at: Date }[]>`
            SELECT id, agent_name, status, summary, created_at FROM agent_runs
            WHERE user_id = ${userId} AND agent_name = ANY(${names}) ORDER BY created_at DESC LIMIT 50
          `
        : await sql<{ id: string; agent_name: string; status: string; summary: string; created_at: Date }[]>`
            SELECT id, agent_name, status, summary, created_at FROM agent_runs
            WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50
          `;
      return success(
        rows.map((r) => ({ id: r.id, agent_code: byName.get(r.agent_name) ?? null, agent_name: r.agent_name, status: r.status, summary: r.summary, created_at: new Date(r.created_at).toISOString() })),
        "Agent runs",
        200,
        requestId
      );
    }

    if (path === "/api/v1/me/agent-usage") {
      const byName = new Map<string, string>();
      for (const a of agents) for (const name of list(a.runtime_names_json)) byName.set(name, a.code);
      const runs = await sql<{ agent_name: string; total: number; failed: number; last_at: Date | null }[]>`
        SELECT agent_name, count(*)::int AS total, count(*) FILTER (WHERE status IN ('failed', 'error'))::int AS failed, max(created_at) AS last_at
        FROM agent_runs WHERE user_id = ${userId} GROUP BY agent_name
      `;
      let calls: { operation: string; today: number; month: number }[] = [];
      try {
        calls = await sql<{ operation: string; today: number; month: number }[]>`
          SELECT operation, count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today, count(*)::int AS month
          FROM ai_usage_events WHERE user_id = ${userId} AND created_at >= date_trunc('month', now()) GROUP BY operation
        `;
      } catch {
        calls = [];
      }
      let pendingApprovals = 0;
      try {
        pendingApprovals = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM approvals WHERE user_id = ${userId} AND decision = 'pending'`)[0]?.n ?? 0;
      } catch {
        pendingApprovals = 0;
      }
      const usage: Record<string, { runs: number; failed: number; last_run_at: string | null; ai_calls_today: number; ai_calls_month: number }> = {};
      const slot = (code: string) => (usage[code] ??= { runs: 0, failed: 0, last_run_at: null, ai_calls_today: 0, ai_calls_month: 0 });
      for (const r of runs) {
        const code = byName.get(r.agent_name);
        if (!code) continue;
        const u = slot(code);
        u.runs += Number(r.total);
        u.failed += Number(r.failed);
        const last = r.last_at ? new Date(r.last_at).toISOString() : null;
        if (last && (!u.last_run_at || last > u.last_run_at)) u.last_run_at = last;
      }
      for (const c of calls) {
        const code = AGENT_FOR_OPERATION[c.operation];
        if (!code) continue;
        const u = slot(code);
        u.ai_calls_today += Number(c.today);
        u.ai_calls_month += Number(c.month);
      }
      return success({ agents: usage, pending_approvals: Number(pendingApprovals) }, "Agent usage", 200, requestId);
    }

    // admin kill switch
    if (!(await loadRoles(sql, userId)).includes("admin")) return failure("NOT_FOUND", "Not found", 404, requestId);
    const payload = (await body(request)) ?? {};
    if (typeof payload.enabled !== "boolean") return failure("INVALID_VALUE", "enabled must be true or false.", 422, requestId);
    const rows = await sql<AgentRow[]>`
      UPDATE agent_definitions SET enabled = ${payload.enabled}, updated_by = ${userId}, updated_at = now() WHERE code = ${toggle![1]} RETURNING *
    `;
    if (!rows[0]) return failure("NOT_FOUND", "Agent not found", 404, requestId);
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "agent.toggled", alert: !payload.enabled, code: rows[0].code, enabled: payload.enabled, by: userId }));
    return success(agentOut(rows[0]), payload.enabled ? `${rows[0].name} switched on` : `${rows[0].name} switched off`, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
