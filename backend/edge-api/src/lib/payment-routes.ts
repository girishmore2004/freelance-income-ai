import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { screenText } from "./listings";
import { contractVersionOut } from "./contracts";
import type { ContractRow, ContractVersionRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";
import {
  applyProviderEvent,
  createFunding,
  intentOut,
  paymentsState,
  payableBalance,
  refundIntent,
  requestPayout,
  verifyWebhookSignature
} from "./payments";
import type { IntentRow } from "./payments";

/**
 * Money-loop routes (Phase 4 batch 2):
 *
 *   GET  /api/v1/contracts/{id}/payments                       per-milestone funding, invoices, cancellation (parties)
 *   POST /api/v1/contracts/{id}/milestones/{i}/fund            client owner/admin; Idempotency-Key header honoured
 *   POST /api/v1/payments/sandbox/{intentId}/complete {outcome: succeed|fail}   sandbox checkout (the client who created it)
 *   POST /api/v1/payments/webhooks/{provider}                  provider webhooks, HMAC-SHA256 (X-Signature); sandbox has none
 *   GET  /api/v1/me/earnings                                   freelancer balance, releases, payouts
 *   POST /api/v1/me/payouts {amount_minor, idempotency_key}
 *   GET  /api/v1/billing/invoices/{id}                         parties of the contract
 *   POST /api/v1/contracts/{id}/cancellation {reason}          either party requests cancelling an active contract
 *   POST /api/v1/contracts/{id}/cancellation/respond {accept}  the other party; accept → cancelled + refunds
 *   POST /api/v1/contracts/{id}/cancellation/withdraw          the requester
 *   GET  /api/v1/admin/payments                                finance/admin: recent payments
 *   POST /api/v1/admin/payments/{intentId}/refund {note}       finance/admin: refund unreleased funds (e.g. dispute outcome)
 */

export interface PaymentRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: PaymentRouteDeps = { database, authenticate: authenticateRequest };

async function sideOf(sql: Queryable, userId: string, contract: ContractRow): Promise<{ party: Party; canManage: boolean } | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  return org ? { party: "client", canManage: canManageOrganization(org.membership_role) } : null;
}

function keyFrom(request: Request, fallback: unknown): string | null {
  const header = request.headers.get("Idempotency-Key");
  const value = header ?? (typeof fallback === "string" ? fallback : null);
  return value && /^[\w.:-]{8,100}$/.test(value) ? value : null;
}

export async function handlePaymentRoute(request: Request, env: Env, requestId: string, deps: PaymentRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const contractPayments = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/payments$/);
  const fund = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/milestones\/(\d{1,2})\/fund$/);
  const sandboxComplete = path.match(/^\/api\/v1\/payments\/sandbox\/([\w-]{1,64})\/complete$/);
  const webhook = path.match(/^\/api\/v1\/payments\/webhooks\/([a-z0-9_]{2,30})$/);
  const invoice = path.match(/^\/api\/v1\/billing\/invoices\/([\w-]{1,64})$/);
  const cancel = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/cancellation(?:\/(respond|withdraw))?$/);
  const adminRefund = path.match(/^\/api\/v1\/admin\/payments\/([\w-]{1,64})\/refund$/);

  const known =
    (method === "GET" && (contractPayments !== null || invoice !== null || path === "/api/v1/me/earnings" || path === "/api/v1/admin/payments")) ||
    (method === "POST" && (fund !== null || sandboxComplete !== null || webhook !== null || cancel !== null || adminRefund !== null || path === "/api/v1/me/payouts"));
  if (!known) return null;

  /* ---------------- provider webhooks (no user session) ---------------- */
  if (webhook) {
    const provider = webhook[1];
    const secret = env.PAYMENT_WEBHOOK_SECRET ?? "";
    // The sandbox has no external webhooks, and no live provider is connected yet (D-2).
    if (provider === "sandbox" || !secret) return failure("NOT_FOUND", "Unknown payment provider", 404, requestId);
    const raw = await request.text();
    const valid = await verifyWebhookSignature(secret, raw, request.headers.get("X-Signature") ?? "");
    if (!valid) {
      console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "payments.webhook_rejected", alert: true, provider }));
      return failure("INVALID_SIGNATURE", "Signature check failed", 401, requestId);
    }
    let parsed: { id?: unknown; type?: unknown; provider_ref?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return failure("INVALID_PAYLOAD", "Body must be JSON", 400, requestId);
    }
    if (typeof parsed.id !== "string" || (parsed.type !== "funding.succeeded" && parsed.type !== "funding.failed") || typeof parsed.provider_ref !== "string") {
      return failure("INVALID_PAYLOAD", "Unsupported event", 400, requestId);
    }
    const sql = deps.database(env);
    try {
      const result = await applyProviderEvent(sql, { provider, event_id: parsed.id, type: parsed.type, provider_ref: parsed.provider_ref, source: "webhook", signature_valid: true, payload: parsed });
      return success({ outcome: result.outcome }, "Event received", 200, requestId);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);

    /* ---------------- freelancer earnings and payouts ---------------- */
    if (path === "/api/v1/me/earnings") {
      const state = await paymentsState(env, sql);
      const mode = state.enabled ? state.mode : "sandbox";
      const released = await sql<(IntentRow & { title: string | null })[]>`
        SELECT i.* FROM payment_intents i JOIN contracts c ON c.id = i.contract_id
        WHERE c.freelancer_user_id = ${userId} AND i.mode = ${mode} AND i.status IN ('funded', 'released')
        ORDER BY i.created_at DESC LIMIT 100
      `;
      const payouts = await sql<{ id: string; amount_minor: string | number; status: string; created_at: Date; paid_at: Date | null }[]>`
        SELECT id, amount_minor, status, created_at, paid_at FROM payouts WHERE user_id = ${userId} AND mode = ${mode} ORDER BY created_at DESC LIMIT 50
      `;
      return success(
        {
          payments_enabled: state.enabled,
          mode,
          note: state.enabled ? (mode === "sandbox" ? "Test mode: no real money moves." : "") : state.reason,
          available_minor: await payableBalance(sql, userId, mode),
          in_escrow_minor: released.filter((r) => r.status === "funded").reduce((s, r) => s + Number(r.amount_minor) - Number(r.freelancer_fee_minor), 0),
          releases: released.map((r) => ({ ...intentOut(r), contract_id: r.contract_id, net_minor: Number(r.amount_minor) - Number(r.freelancer_fee_minor) })),
          payouts: payouts.map((p) => ({ id: p.id, amount_minor: Number(p.amount_minor), status: p.status, created_at: new Date(p.created_at).toISOString(), paid_at: p.paid_at ? new Date(p.paid_at).toISOString() : null }))
        },
        "Earnings",
        200,
        requestId
      );
    }

    if (path === "/api/v1/me/payouts") {
      const payload = (await body(request)) ?? {};
      const key = keyFrom(request, payload.idempotency_key);
      if (!key) return failure("IDEMPOTENCY_KEY_REQUIRED", "Send an idempotency key (8–100 characters) so a retry never pays twice.", 422, requestId);
      const result = await requestPayout(env, sql, userId, Number(payload.amount_minor), key);
      if (!result.ok) return failure(result.code, result.message, result.code === "PAYMENTS_DISABLED" ? 409 : 422, requestId);
      return success(result.payout, result.duplicate ? "This payout was already requested" : result.payout.mode === "sandbox" ? "Test payout completed (no real money)" : "Payout requested", result.duplicate ? 200 : 201, requestId);
    }

    /* ---------------- staff ---------------- */
    if (path === "/api/v1/admin/payments" || adminRefund) {
      const roles = await loadRoles(sql, userId);
      if (!roles.includes("admin") && !roles.includes("finance")) return failure("NOT_FOUND", "Not found", 404, requestId);
      if (!adminRefund) {
        const rows = await sql<IntentRow[]>`SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT 200`;
        return success(rows.map((r) => ({ ...intentOut(r), contract_id: r.contract_id, provider_ref: r.provider_ref })), "Payments", 200, requestId);
      }
      const payload = (await body(request)) ?? {};
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (note.length < 5) return failure("NOTE_REQUIRED", "Record why the refund is made (at least 5 characters).", 422, requestId);
      const intent = (await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${adminRefund[1]} LIMIT 1`)[0];
      if (!intent) return failure("NOT_FOUND", "Payment not found", 404, requestId);
      const outcome = await refundIntent(sql, intent, `Staff refund: ${note}`);
      if (outcome === "not_refundable") return failure("NOT_REFUNDABLE", `A ${intent.status} payment cannot be refunded here.`, 409, requestId);
      await sql`
        INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'payment', ${intent.id}, ${`payment.${outcome}`}, ${note.slice(0, 2000)}, now())
      `;
      return success({ id: intent.id, outcome }, outcome === "refunded" ? "Refunded" : "Unpaid checkout cancelled", 200, requestId);
    }

    /* ---------------- sandbox checkout ---------------- */
    if (sandboxComplete) {
      const intent = (await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${sandboxComplete[1]} LIMIT 1`)[0];
      if (!intent || intent.created_by !== userId || intent.provider !== "sandbox") return failure("NOT_FOUND", "Payment not found", 404, requestId);
      const payload = (await body(request)) ?? {};
      const outcome = payload.outcome === "fail" ? "fail" : payload.outcome === "succeed" ? "succeed" : null;
      if (!outcome) return failure("INVALID_OUTCOME", "outcome must be succeed or fail.", 422, requestId);
      const result = await applyProviderEvent(sql, {
        provider: "sandbox",
        event_id: `sbx_ev_${intent.id}_${outcome}`,
        type: outcome === "succeed" ? "funding.succeeded" : "funding.failed",
        provider_ref: intent.provider_ref,
        source: "sandbox",
        signature_valid: true,
        payload: { intent: intent.id, outcome }
      });
      const fresh = (await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${intent.id}`)[0];
      return success(
        { ...intentOut(fresh), outcome: result.outcome },
        fresh.status === "funded" ? "Test payment completed: milestone funded (no real money)" : fresh.status === "failed" ? "Test payment failed" : `Payment is ${fresh.status}`,
        200,
        requestId
      );
    }

    /* ---------------- invoices ---------------- */
    if (invoice) {
      const row = (await sql<Record<string, unknown>[]>`SELECT * FROM billing_invoices WHERE id = ${invoice[1]} LIMIT 1`)[0];
      const contract = row ? (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${String(row.contract_id)} LIMIT 1`)[0] : undefined;
      const side = contract ? await sideOf(sql, userId, contract) : null;
      if (!row || !side) return failure("NOT_FOUND", "Invoice not found", 404, requestId);
      const org = (await sql<{ name: string; legal_name?: string; billing_email?: string; tax_id?: string }[]>`SELECT * FROM organizations WHERE id = ${String(row.organization_id)} LIMIT 1`)[0];
      return success(
        {
          id: row.id, number: row.number, mode: row.mode, status: row.status, milestone_title: row.milestone_title,
          amount_minor: Number(row.amount_minor), client_fee_minor: Number(row.client_fee_minor), total_minor: Number(row.total_minor), currency: row.currency,
          issued_to: org?.legal_name || org?.name || "", created_at: new Date(row.created_at as Date).toISOString(),
          notice: row.mode === "sandbox" ? "TEST DOCUMENT — not a tax invoice. No money was paid." : "Tax details depend on D-1 and are not shown yet."
        },
        "Invoice",
        200,
        requestId
      );
    }

    /* ---------------- contract-scoped ---------------- */
    const contractId = (contractPayments ?? fund ?? cancel)![1];
    const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
    const side = contract ? await sideOf(sql, userId, contract) : null;
    if (!contract || !side) return failure("NOT_FOUND", "Contract not found", 404, requestId);

    if (contractPayments) {
      const state = await paymentsState(env, sql);
      const version = (await sql<ContractVersionRow[]>`
        SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
      `)[0];
      const terms = version ? contractVersionOut(version) : null;
      const intents = await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE contract_id = ${contract.id} ORDER BY created_at DESC`;
      const invoices = await sql<{ id: string; number: string; milestone_title: string; total_minor: string | number; status: string; mode: string }[]>`
        SELECT id, number, milestone_title, total_minor, status, mode FROM billing_invoices WHERE contract_id = ${contract.id} ORDER BY created_at DESC
      `;
      const cancellation = (await sql<{ id: string; requested_by_party: string; reason: string; status: string; created_at: Date }[]>`
        SELECT id, requested_by_party, reason, status, created_at FROM contract_cancellations WHERE contract_id = ${contract.id} ORDER BY created_at DESC LIMIT 1
      `)[0];
      const fees = (await sql<{ id: string }[]>`SELECT id FROM fee_schedules WHERE status = 'approved' LIMIT 1`)[0];
      return success(
        {
          enabled: state.enabled,
          mode: state.enabled ? state.mode : null,
          notice: state.enabled ? (state.mode === "sandbox" ? "Test payments: no real money moves." : "") : state.reason,
          fees_configured: Boolean(fees),
          require_funding: await isEnabled(env, sql, FLAGS.requireFunding, false),
          can_fund: side.party === "client" && side.canManage && contract.status === "active",
          milestones: (terms?.milestones ?? []).map((m, index) => {
            const latest = intents.find((i) => i.milestone_index === index && i.status !== "cancelled");
            return { index, title: m.title, amount_minor: m.amount_minor, payment: latest ? intentOut(latest) : null };
          }),
          invoices: invoices.map((i) => ({ id: i.id, number: i.number, milestone_title: i.milestone_title, total_minor: Number(i.total_minor), status: i.status, mode: i.mode })),
          cancellation: cancellation
            ? { id: cancellation.id, requested_by: cancellation.requested_by_party, mine: cancellation.requested_by_party === side.party, reason: cancellation.reason, status: cancellation.status }
            : null
        },
        "Payments",
        200,
        requestId
      );
    }

    if (fund) {
      if (side.party !== "client" || !side.canManage) return failure("FORBIDDEN", "Only client owners and admins fund milestones.", 403, requestId);
      const payload = (await body(request)) ?? {};
      const key = keyFrom(request, payload.idempotency_key) ?? `fund:${contract.id}:${fund[2]}:${crypto.randomUUID()}`;
      const result = await createFunding(env, sql, { contract, milestoneIndex: Number(fund[2]), userId, idempotencyKey: key });
      if (!result.ok) {
        const status = result.code === "NO_MILESTONE" ? 404 : 409;
        return failure(result.code, result.message, status, requestId);
      }
      return success(
        { payment: intentOut(result.intent), checkout: result.checkout },
        result.intent.mode === "sandbox" ? "Test checkout created. Complete it to fund the milestone (no real money)." : "Checkout created",
        result.duplicate ? 200 : 201,
        requestId
      );
    }

    /* ---------------- cancellation ---------------- */
    const action = cancel![2];
    const payload = (await body(request)) ?? {};
    if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins can act for the client.", 403, requestId);

    if (!action) {
      if (contract.status !== "active") return failure("CONTRACT_NOT_ACTIVE", "Only active contracts can be cancelled.", 409, requestId);
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 10 || reason.length > 2000) return failure("REASON_REQUIRED", "Explain why (10–2,000 characters).", 422, requestId);
      if (screenText(reason).length) return failure("MESSAGE_NOT_ALLOWED", "Keep contact and payment details off the platform record.", 422, requestId);
      const rows = await sql<{ id: string }[]>`
        INSERT INTO contract_cancellations (id, contract_id, requested_by_party, requested_by, reason, status, created_at)
        VALUES (${crypto.randomUUID()}, ${contract.id}, ${side.party}, ${userId}, ${reason}, 'open', now())
        ON CONFLICT (contract_id) WHERE status = 'open' DO NOTHING
        RETURNING id
      `;
      if (!rows[0]) return failure("ALREADY_REQUESTED", "A cancellation request is already open.", 409, requestId);
      await recordContractEvent(sql, contract.id, userId, side.party, "cancellation.requested", {});
      return success({ id: rows[0].id }, "Cancellation requested. The other party must accept it.", 201, requestId);
    }

    const open = (await sql<{ id: string; requested_by_party: string }[]>`
      SELECT id, requested_by_party FROM contract_cancellations WHERE contract_id = ${contract.id} AND status = 'open' LIMIT 1
    `)[0];
    if (!open) return failure("NO_REQUEST", "There is no open cancellation request.", 409, requestId);

    if (action === "withdraw") {
      if (open.requested_by_party !== side.party) return failure("FORBIDDEN", "Only the side that asked can withdraw the request.", 403, requestId);
      await sql`UPDATE contract_cancellations SET status = 'withdrawn', responded_by = ${userId}, responded_at = now() WHERE id = ${open.id} AND status = 'open'`;
      await recordContractEvent(sql, contract.id, userId, side.party, "cancellation.withdrawn", {});
      return success({ id: open.id }, "Cancellation request withdrawn", 200, requestId);
    }

    // respond
    if (open.requested_by_party === side.party) return failure("FORBIDDEN", "The other party must answer this request.", 403, requestId);
    if (typeof payload.accept !== "boolean") return failure("INVALID_VALUE", "accept must be true or false.", 422, requestId);
    if (!payload.accept) {
      await sql`UPDATE contract_cancellations SET status = 'declined', responded_by = ${userId}, responded_at = now() WHERE id = ${open.id} AND status = 'open'`;
      await recordContractEvent(sql, contract.id, userId, side.party, "cancellation.declined", {});
      return success({ id: open.id, cancelled: false }, "Cancellation declined. You can raise a dispute if you cannot agree.", 200, requestId);
    }
    const done = await sql.begin(async (tx) => {
      const updated = await tx<{ id: string }[]>`UPDATE contract_cancellations SET status = 'accepted', responded_by = ${userId}, responded_at = now() WHERE id = ${open.id} AND status = 'open' RETURNING id`;
      if (!updated[0]) return false;
      await tx`UPDATE contracts SET status = 'cancelled', updated_at = now() WHERE id = ${contract.id} AND status = 'active'`;
      await recordContractEvent(tx, contract.id, userId, side.party, "contract.cancelled", { by_agreement: true });
      return true;
    });
    if (!done) return failure("NO_REQUEST", "There is no open cancellation request.", 409, requestId);
    // Refund every unreleased funding (approved work stays paid).
    const unreleased = await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE contract_id = ${contract.id} AND status IN ('created', 'funded')`;
    let refunded = 0;
    for (const intent of unreleased) if ((await refundIntent(sql, intent, "Contract cancelled by agreement")) === "refunded") refunded += 1;
    return success({ id: open.id, cancelled: true, refunded_milestones: refunded }, refunded ? `Contract cancelled. ${refunded} funded milestone(s) refunded to the client.` : "Contract cancelled.", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
