import type { Env } from "../types";
import type { Sql } from "./core-routes";

/**
 * Server-side feature flags (table `feature_flags`, migration 0049).
 *
 * Resolution order:
 *   1. FEATURE_FLAGS_OFF (comma-separated Worker variable) forces a flag OFF.
 *      This is the emergency kill switch: change the variable in the
 *      Cloudflare dashboard; no code deploy or database access needed.
 *   2. The database row.
 *   3. The caller's default (use false for anything incomplete or risky).
 *
 * If the table is missing or the database errors, the default is used and
 * the failure is logged, so a flag read never takes a route down.
 */

export const FLAGS = {
  aiGeneration: "ai.generation",
  scheduledDiscovery: "queue.scheduled_discovery",
  clientMarketplace: "marketplace.client_side",
  paymentsLive: "payments.live"
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

export function forcedOff(env: Env): Set<string> {
  return new Set(
    String(env.FEATURE_FLAGS_OFF ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export async function isEnabled(env: Env, sql: Sql, key: FlagKey, fallback: boolean): Promise<boolean> {
  const off = forcedOff(env);
  if (off.has(key) || off.has("*")) return false;
  try {
    const rows = await sql<{ enabled: boolean }[]>`SELECT enabled FROM feature_flags WHERE key = ${key} LIMIT 1`;
    return rows.length ? Boolean(rows[0].enabled) : fallback;
  } catch (error) {
    console.warn(JSON.stringify({ event: "feature_flag.read_failed", key, error_message: error instanceof Error ? error.message : "unknown" }));
    return fallback;
  }
}
