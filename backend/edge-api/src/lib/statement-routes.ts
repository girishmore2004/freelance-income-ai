import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { database } from "./core-routes";
import type { Sql } from "./core-routes";
import { failure, success } from "./response";
import { canManageOrganization, organizationForMember } from "./identity";

/**
 * Monthly money statements (U13; spec §12 "Finance and earnings").
 *
 *   GET /api/v1/me/statements?month=YYYY-MM                          freelancer: released milestones, fees and payouts
 *   GET /api/v1/me/statements?month=YYYY-MM&organization_id=…        client (owner/admin): funded milestones, fees, refunds
 *   … &format=csv                                                     the same lines as a CSV download
 *
 * Read-only, from payment records. Test-mode (sandbox) and live amounts are
 * always totalled separately and labelled; nothing here is a tax invoice.
 */

export interface StatementRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: StatementRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

export type StatementLine = { date: string; kind: "release" | "funding" | "refund" | "payout"; mode: string; contract: string; milestone: number | null; gross_minor: number; fee_minor: number; net_minor: number; currency: string };

/** Month bounds in UTC; null for a malformed or future month. Pure. */
export function monthRange(month: string | null, now: Date): { month: string; from: string; to: string } | null {
  const m = month ?? now.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1));
  const to = new Date(Date.UTC(y, mo, 1));
  if (from.getTime() > now.getTime()) return null;
  if (from.getTime() < Date.UTC(2020, 0, 1)) return null;
  return { month: m, from: from.toISOString(), to: to.toISOString() };
}

/** Totals per payment mode and currency. Pure. */
export function totals(lines: StatementLine[]): Array<{ mode: string; currency: string; gross_minor: number; fee_minor: number; net_minor: number; payouts_minor: number; refunds_minor: number }> {
  const map = new Map<string, { mode: string; currency: string; gross_minor: number; fee_minor: number; net_minor: number; payouts_minor: number; refunds_minor: number }>();
  for (const l of lines) {
    const key = `${l.mode}|${l.currency}`;
    const t = map.get(key) ?? { mode: l.mode, currency: l.currency, gross_minor: 0, fee_minor: 0, net_minor: 0, payouts_minor: 0, refunds_minor: 0 };
    if (l.kind === "payout") t.payouts_minor += l.gross_minor;
    else if (l.kind === "refund") t.refunds_minor += l.gross_minor;
    else { t.gross_minor += l.gross_minor; t.fee_minor += l.fee_minor; t.net_minor += l.net_minor; }
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.currency.localeCompare(b.currency));
}

const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  // Neutralise spreadsheet formulas and quote every field.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const money = (minor: number) => (minor / 100).toFixed(2);

/** CSV with a header row; amounts in major units. Pure. */
export function toCsv(lines: StatementLine[]): string {
  const header = ["date", "type", "mode", "contract", "milestone", "gross", "platform_fee", "net", "currency"];
  const rows = lines.map((l) => [l.date, l.kind, l.mode === "sandbox" ? "test" : l.mode, l.contract, l.milestone === null ? "" : l.milestone + 1, money(l.gross_minor), money(l.fee_minor), money(l.net_minor), l.currency]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

type IntentRow = { contract_id: string; title: string; milestone_index: number; amount_minor: string | number; client_fee_minor: string | number; freelancer_fee_minor: string | number; total_minor: string | number; currency: string; mode: string; at: Date };

export async function handleStatementRoute(request: Request, env: Env, requestId: string, deps: StatementRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1/me/statements" || request.method.toUpperCase() !== "GET") return null;
  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const range = monthRange(url.searchParams.get("month"), deps.now());
  if (!range) return failure("INVALID_MONTH", "Use month=YYYY-MM for this month or an earlier one.", 422, requestId);
  const orgId = url.searchParams.get("organization_id");
  const sql = deps.database(env);

  try {
    const n = (v: string | number) => Number(v);
    const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
    let lines: StatementLine[] = [];
    let side: "freelancer" | "client" = "freelancer";
    try {
      if (orgId) {
        side = "client";
        const org = await organizationForMember(sql, userId, orgId);
        if (!org) return failure("NOT_FOUND", "Client account not found", 404, requestId);
        if (!canManageOrganization(org.membership_role)) return failure("FORBIDDEN", "Owners and admins see the account's statements.", 403, requestId);
        const funded = await sql<IntentRow[]>`
          SELECT p.contract_id, v.title, p.milestone_index, p.amount_minor, p.client_fee_minor, p.freelancer_fee_minor, p.total_minor, p.currency, p.mode, p.funded_at AS at
          FROM payment_intents p JOIN contracts c ON c.id = p.contract_id
          JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
          WHERE c.organization_id = ${orgId} AND p.funded_at >= ${range.from} AND p.funded_at < ${range.to}
          ORDER BY p.funded_at ASC LIMIT 2000
        `;
        const refunded = await sql<IntentRow[]>`
          SELECT p.contract_id, v.title, p.milestone_index, p.amount_minor, p.client_fee_minor, p.freelancer_fee_minor, p.total_minor, p.currency, p.mode, p.refunded_at AS at
          FROM payment_intents p JOIN contracts c ON c.id = p.contract_id
          JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
          WHERE c.organization_id = ${orgId} AND p.refunded_at >= ${range.from} AND p.refunded_at < ${range.to}
          ORDER BY p.refunded_at ASC LIMIT 2000
        `;
        lines = [
          ...funded.map((p): StatementLine => ({ date: day(p.at), kind: "funding", mode: p.mode, contract: p.title, milestone: p.milestone_index, gross_minor: n(p.amount_minor), fee_minor: n(p.client_fee_minor), net_minor: n(p.total_minor), currency: p.currency })),
          ...refunded.map((p): StatementLine => ({ date: day(p.at), kind: "refund", mode: p.mode, contract: p.title, milestone: p.milestone_index, gross_minor: n(p.total_minor), fee_minor: 0, net_minor: n(p.total_minor), currency: p.currency }))
        ];
      } else {
        const released = await sql<IntentRow[]>`
          SELECT p.contract_id, v.title, p.milestone_index, p.amount_minor, p.client_fee_minor, p.freelancer_fee_minor, p.total_minor, p.currency, p.mode, p.released_at AS at
          FROM payment_intents p JOIN contracts c ON c.id = p.contract_id
          JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
          WHERE c.freelancer_user_id = ${userId} AND p.released_at >= ${range.from} AND p.released_at < ${range.to}
          ORDER BY p.released_at ASC LIMIT 2000
        `;
        const payouts = await sql<Array<{ amount_minor: string | number; currency: string; mode: string; paid_at: Date }>>`
          SELECT amount_minor, currency, mode, paid_at FROM payouts
          WHERE user_id = ${userId} AND status = 'paid' AND paid_at >= ${range.from} AND paid_at < ${range.to}
          ORDER BY paid_at ASC LIMIT 2000
        `;
        lines = [
          ...released.map((p): StatementLine => ({ date: day(p.at), kind: "release", mode: p.mode, contract: p.title, milestone: p.milestone_index, gross_minor: n(p.amount_minor), fee_minor: n(p.freelancer_fee_minor), net_minor: n(p.amount_minor) - n(p.freelancer_fee_minor), currency: p.currency })),
          ...payouts.map((p): StatementLine => ({ date: day(p.paid_at), kind: "payout", mode: p.mode, contract: "Withdrawal", milestone: null, gross_minor: n(p.amount_minor), fee_minor: 0, net_minor: n(p.amount_minor), currency: p.currency }))
        ];
      }
    } catch (error) {
      // Payment tables not migrated yet (0061): an empty statement, not an error.
      if (!(error instanceof Error && /does not exist/.test(error.message))) throw error;
      lines = [];
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

    if (url.searchParams.get("format") === "csv") {
      return new Response(toCsv(lines), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="statement-${side}-${range.month}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    return success(
      {
        month: range.month, side, lines, totals: totals(lines),
        note: "Built from payment records. Test-mode amounts are not real money. This is not a tax invoice."
      },
      "Statement",
      200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
