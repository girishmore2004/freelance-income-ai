import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles } from "./identity";
import { tableExists } from "./external-pipeline";
import { SOURCE_CATALOGUE } from "./discovery-agent";

/**
 * External source management and opportunity freshness (U10; spec §14).
 *
 *   GET  /api/v1/admin/sources                 admin, moderator: each source's switch, last 7 days of runs, failures, volume and freshness
 *   POST /api/v1/admin/sources/{code} {enabled, note}   admin only; switching off needs a reason; logged
 *
 * Freshness counts open external opportunities (new or drafted) by the age of
 * the original post: under 3 days, 3–14 days, over 14 days, or unknown when the
 * source gave no date.
 */

export interface SourceRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: SourceRouteDeps = { database, authenticate: authenticateRequest };

export type SourceHealth = "healthy" | "failing" | "partly_failing" | "no_runs" | "off";

/** Plain status from the last 7 days. Pure, exported for tests. */
export function sourceHealth(enabled: boolean, runs: number, failures: number, lastWasError: boolean): SourceHealth {
  if (!enabled) return "off";
  if (runs === 0) return "no_runs";
  if (failures === runs || (lastWasError && failures / runs >= 0.5)) return "failing";
  if (failures > 0) return "partly_failing";
  return "healthy";
}

type Stats = { source: string; runs: number; failures: number; fetched: number; last_success_at: Date | null; last_error: string | null; last_error_at: Date | null; last_at: Date | null };
type Fresh = { source: string; open: number; under_3: number; d3_14: number; over_14: number; unknown: number; stored_7d: number };

export async function handleSourceRoute(request: Request, env: Env, requestId: string, deps: SourceRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const toggle = path.match(/^\/api\/v1\/admin\/sources\/([a-z0-9_]{1,40})$/);
  const known = (path === "/api/v1/admin/sources" && method === "GET") || (toggle !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    const roles = await loadRoles(sql, userId);
    const isAdmin = roles.includes("admin");
    if (!isAdmin && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);
    const ready = await tableExists(sql, "discovery_sources");

    if (toggle) {
      if (!isAdmin) return failure("FORBIDDEN", "Only admins switch sources on or off.", 403, requestId);
      if (!ready) return failure("MIGRATION_PENDING", "Source management needs database migration 0071.", 503, requestId);
      const code = toggle[1];
      if (!SOURCE_CATALOGUE.some((s) => s.code === code)) return failure("NOT_FOUND", "Unknown source", 404, requestId);
      const payload = (await body(request)) ?? {};
      if (typeof payload.enabled !== "boolean") return failure("INVALID_REQUEST", "enabled must be true or false.", 422, requestId);
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 500) : "";
      if (!payload.enabled && note.length < 5) return failure("NOTE_REQUIRED", "Say why the source is switched off (5 characters or more).", 422, requestId);
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO discovery_sources (code, enabled, note, updated_by, updated_at) VALUES (${code}, ${payload.enabled as boolean}, ${note}, ${userId}, now())
          ON CONFLICT (code) DO UPDATE SET enabled = EXCLUDED.enabled, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()
        `;
        await tx`
          INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
          VALUES (${crypto.randomUUID()}, ${userId}, 'source', ${code}, ${payload.enabled ? "source.enabled" : "source.disabled"}, ${note}, now())
        `;
      });
      return success({ code, enabled: payload.enabled, note }, payload.enabled ? "Source switched on" : "Source switched off", 200, requestId);
    }

    const switches = ready
      ? await sql<Array<{ code: string; enabled: boolean; note: string; updated_at: Date }>>`SELECT code, enabled, note, updated_at FROM discovery_sources`
      : [];
    const stats = (await tableExists(sql, "discovery_source_runs"))
      ? await sql<Stats[]>`
          SELECT source, count(*)::int AS runs, count(*) FILTER (WHERE error <> '')::int AS failures, COALESCE(sum(fetched), 0)::int AS fetched,
                 max(created_at) FILTER (WHERE error = '') AS last_success_at, max(created_at) AS last_at,
                 (array_agg(error ORDER BY created_at DESC) FILTER (WHERE error <> ''))[1] AS last_error,
                 max(created_at) FILTER (WHERE error <> '') AS last_error_at
          FROM discovery_source_runs WHERE created_at > now() - interval '7 days'
          GROUP BY source
        `
      : [];
    const fresh = await sql<Fresh[]>`
      SELECT source,
             count(*) FILTER (WHERE status IN ('new', 'drafted'))::int AS open,
             count(*) FILTER (WHERE status IN ('new', 'drafted') AND published_at IS NOT NULL AND published_at > now() - interval '3 days')::int AS under_3,
             count(*) FILTER (WHERE status IN ('new', 'drafted') AND published_at <= now() - interval '3 days' AND published_at > now() - interval '14 days')::int AS d3_14,
             count(*) FILTER (WHERE status IN ('new', 'drafted') AND published_at <= now() - interval '14 days')::int AS over_14,
             count(*) FILTER (WHERE status IN ('new', 'drafted') AND published_at IS NULL)::int AS unknown,
             count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS stored_7d
      FROM opportunities GROUP BY source
    `.catch(() => [] as Fresh[]);
    const jobBoardsOff = env.INCLUDE_JOB_BOARDS === "false";
    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

    const items = SOURCE_CATALOGUE.map((c) => {
      const sw = switches.find((s) => s.code === c.code);
      const st = stats.find((s) => s.source === c.code);
      const fr = fresh.find((f) => f.source === c.code);
      const enabled = (sw ? sw.enabled : true) && !(c.kind === "job_board" && jobBoardsOff);
      const lastWasError = Boolean(st?.last_error_at && st.last_at && new Date(st.last_error_at).getTime() === new Date(st.last_at).getTime());
      return {
        ...c,
        enabled,
        switch_enabled: sw ? sw.enabled : true,
        off_by_worker_setting: c.kind === "job_board" && jobBoardsOff,
        note: sw?.note ?? "",
        updated_at: iso(sw?.updated_at),
        health: sourceHealth(enabled, st?.runs ?? 0, st?.failures ?? 0, lastWasError),
        runs_7d: st?.runs ?? 0,
        failures_7d: st?.failures ?? 0,
        fetched_7d: st?.fetched ?? 0,
        stored_7d: fr?.stored_7d ?? 0,
        last_success_at: iso(st?.last_success_at),
        last_error: st?.last_error ?? null,
        last_error_at: iso(st?.last_error_at),
        freshness: { open: fr?.open ?? 0, under_3_days: fr?.under_3 ?? 0, days_3_to_14: fr?.d3_14 ?? 0, over_14_days: fr?.over_14 ?? 0, unknown: fr?.unknown ?? 0 }
      };
    });
    const others = fresh.filter((f) => !SOURCE_CATALOGUE.some((c) => c.code === f.source)).map((f) => ({ source: f.source, open: f.open, stored_7d: f.stored_7d }));
    return success({ available: ready, can_manage: isAdmin, items, other_sources: others }, "Sources", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
