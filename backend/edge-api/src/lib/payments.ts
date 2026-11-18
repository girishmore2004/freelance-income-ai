import type { Env } from "../types";
import type { Queryable, Sql } from "./core-routes";
import { FLAGS, isEnabled } from "./flags";
import { postEntry } from "./ledger";
import type { AccountRef, LedgerMode } from "./ledger";
import { quoteFees } from "./fees";
import { contractVersionOut } from "./contracts";
import type { ContractRow, ContractVersionRow } from "./contracts";
import { recordContractEvent } from "./contract-events";

/**
 * Money loop (Phase 4 batch 2), provider-agnostic.
 *
 *   fund milestone  → client pays amount + client fee to the provider
 *   approve work    → amount − freelancer fee becomes payable to the freelancer; both fees become revenue
 *   refund          → unreleased funds and the client fee go back to the client
 *   payout          → freelancer withdraws from the payable balance
 *
 * Every step is a balanced, idempotent ledger entry. Funds are held by the
 * payment provider (the clearing account); the platform never keeps customer
 * money itself. Only the sandbox provider exists: `live` mode is refused until
 * the legal entity and provider are approved (D-1/D-2) and a live adapter is
 * written. Amounts and fees are computed by fixed rules, never by a model.
 */

export type PaymentMode = LedgerMode;

export interface FundingCheckout {
  provider: string;
  provider_ref: string;
  /** For the sandbox: where the client completes the test payment. */
  sandbox_complete_path?: string;
}

export interface PaymentProvider {
  name: string;
  mode: PaymentMode;
  createFunding(intentId: string, totalMinor: number, currency: string): Promise<FundingCheckout>;
  createPayout(payoutId: string, amountMinor: number, currency: string): Promise<{ provider_ref: string; status: "paid" | "requested" }>;
}

/** Test provider: no network, no money. References are random and unique. */
export const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  mode: "sandbox",
  async createFunding(intentId) {
    return { provider: "sandbox", provider_ref: `sbx_pi_${crypto.randomUUID()}`, sandbox_complete_path: `/api/v1/payments/sandbox/${intentId}/complete` };
  },
  async createPayout() {
    return { provider_ref: `sbx_po_${crypto.randomUUID()}`, status: "paid" };
  }
};

export type PaymentsState = { enabled: true; mode: PaymentMode; provider: PaymentProvider } | { enabled: false; reason: string };

export async function paymentsState(env: Env, sql: Queryable): Promise<PaymentsState> {
  if (await isEnabled(env, sql, FLAGS.paymentsLive, false)) {
    return { enabled: false, reason: "Live payments are not available: no live payment provider is connected (D-1/D-2)." };
  }
  if (await isEnabled(env, sql, FLAGS.paymentsSandbox, false)) return { enabled: true, mode: "sandbox", provider: sandboxProvider };
  return { enabled: false, reason: "Payments are not enabled yet." };
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export const accounts = {
  clearing: (provider: string): AccountRef => ({ code: `provider:${provider}:clearing`, name: `${provider} provider clearing`, kind: "asset", owner_type: "provider" }),
  fundsHeld: (contractId: string): AccountRef => ({ code: `funds_held:contract:${contractId}`, name: `Funds held for contract ${contractId}`, kind: "liability" }),
  feesHeld: (contractId: string): AccountRef => ({ code: `fees_held:contract:${contractId}`, name: `Client fees held for contract ${contractId}`, kind: "liability" }),
  freelancerPayable: (userId: string): AccountRef => ({ code: `freelancer_payable:${userId}`, name: `Payable to freelancer ${userId}`, kind: "liability", owner_type: "user", owner_id: userId }),
  feeRevenue: (): AccountRef => ({ code: "platform:revenue:fees", name: "Platform fee revenue", kind: "revenue" })
};

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface IntentRow {
  id: string;
  contract_id: string;
  milestone_index: number;
  contract_version: number;
  amount_minor: string | number;
  client_fee_minor: string | number;
  freelancer_fee_minor: string | number;
  total_minor: string | number;
  currency: string;
  fee_schedule_id: string;
  provider: string;
  provider_ref: string;
  mode: PaymentMode;
  status: string;
  created_by: string | null;
  created_at: Date;
  funded_at: Date | null;
  released_at: Date | null;
  refunded_at: Date | null;
}

export function intentOut(i: IntentRow) {
  return {
    id: i.id,
    milestone_index: i.milestone_index,
    amount_minor: Number(i.amount_minor),
    client_fee_minor: Number(i.client_fee_minor),
    freelancer_fee_minor: Number(i.freelancer_fee_minor),
    total_minor: Number(i.total_minor),
    currency: i.currency,
    mode: i.mode,
    status: i.status,
    funded_at: i.funded_at ? new Date(i.funded_at).toISOString() : null,
    released_at: i.released_at ? new Date(i.released_at).toISOString() : null,
    refunded_at: i.refunded_at ? new Date(i.refunded_at).toISOString() : null
  };
}

async function agreedTerms(sql: Queryable, contract: ContractRow) {
  const row = (await sql<ContractVersionRow[]>`
    SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
  `)[0];
  return row ? contractVersionOut(row) : null;
}

/* ------------------------------------------------------------------ */
/* Funding                                                             */
/* ------------------------------------------------------------------ */

export type FundingResult =
  | { ok: true; intent: IntentRow; checkout: FundingCheckout; duplicate: boolean }
  | { ok: false; code: "PAYMENTS_DISABLED" | "CONTRACT_NOT_ACTIVE" | "NO_MILESTONE" | "ALREADY_FUNDED" | "MILESTONE_APPROVED" | "FEES_NOT_CONFIGURED"; message: string };

export async function createFunding(
  env: Env,
  sql: Sql,
  input: { contract: ContractRow; milestoneIndex: number; userId: string; idempotencyKey: string }
): Promise<FundingResult> {
  const state = await paymentsState(env, sql);
  if (!state.enabled) return { ok: false, code: "PAYMENTS_DISABLED", message: state.reason };
  const { contract, milestoneIndex } = input;
  if (contract.status !== "active") return { ok: false, code: "CONTRACT_NOT_ACTIVE", message: "Only active contracts can be funded." };

  const existingByKey = (await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`)[0];
  if (existingByKey) {
    return { ok: true, intent: existingByKey, checkout: { provider: existingByKey.provider, provider_ref: existingByKey.provider_ref, sandbox_complete_path: `/api/v1/payments/sandbox/${existingByKey.id}/complete` }, duplicate: true };
  }

  const terms = await agreedTerms(sql, contract);
  const milestone = terms?.milestones[milestoneIndex];
  if (!terms || !milestone) return { ok: false, code: "NO_MILESTONE", message: "Milestone not found." };
  const approved = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM milestone_submissions WHERE contract_id = ${contract.id} AND milestone_index = ${milestoneIndex} AND status = 'approved'
  `;
  if ((approved[0]?.n ?? 0) > 0) return { ok: false, code: "MILESTONE_APPROVED", message: "This milestone is already approved." };
  const open = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM payment_intents WHERE contract_id = ${contract.id} AND milestone_index = ${milestoneIndex} AND status IN ('created', 'funded', 'released') LIMIT 1
  `;
  if (open[0] && open[0].status !== "created") return { ok: false, code: "ALREADY_FUNDED", message: "This milestone is already funded." };

  const schedule = (await sql<{ id: string; currency: string; client_fee_bps: number; freelancer_fee_bps: number; min_fee_minor: string | number }[]>`
    SELECT id, currency, client_fee_bps, freelancer_fee_bps, min_fee_minor FROM fee_schedules
    WHERE status = 'approved' AND currency = ${terms.currency} AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1
  `)[0];
  if (!schedule) return { ok: false, code: "FEES_NOT_CONFIGURED", message: "Platform fees have not been approved yet (finance page)." };
  const quote = quoteFees(milestone.amount_minor, { ...schedule, min_fee_minor: Number(schedule.min_fee_minor) });

  // An unpaid checkout for the same milestone is replaced by the new one.
  if (open[0]) await sql`UPDATE payment_intents SET status = 'cancelled', updated_at = now() WHERE id = ${open[0].id} AND status = 'created'`;

  const id = crypto.randomUUID();
  const checkout = await state.provider.createFunding(id, quote.client_pays_minor, terms.currency);
  const rows = await sql<IntentRow[]>`
    INSERT INTO payment_intents
      (id, contract_id, milestone_index, contract_version, amount_minor, client_fee_minor, freelancer_fee_minor, total_minor, currency,
       fee_schedule_id, provider, provider_ref, mode, status, idempotency_key, created_by, created_at, updated_at)
    VALUES (${id}, ${contract.id}, ${milestoneIndex}, ${contract.agreed_version ?? contract.current_version}, ${quote.amount_minor},
            ${quote.client_fee_minor}, ${quote.freelancer_fee_minor}, ${quote.client_pays_minor}, ${terms.currency}, ${schedule.id},
            ${checkout.provider}, ${checkout.provider_ref}, ${state.mode}, 'created', ${input.idempotencyKey}, ${input.userId}, now(), now())
    RETURNING *
  `;
  return { ok: true, intent: rows[0], checkout, duplicate: false };
}

/* ------------------------------------------------------------------ */
/* Provider events                                                     */
/* ------------------------------------------------------------------ */

export type ProviderEventType = "funding.succeeded" | "funding.failed";

export interface ProviderEvent {
  provider: string;
  event_id: string;
  type: ProviderEventType;
  provider_ref: string;
  source: "webhook" | "sandbox";
  signature_valid: boolean;
  payload: unknown;
}

function invoiceNumber(mode: PaymentMode): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `FIA-${mode === "sandbox" ? "TEST" : "INV"}-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * Applies a provider event exactly once. The raw event is stored first; a
 * repeat of an already processed event changes nothing. Ledger entries are
 * idempotent per intent, and status changes are conditional, so a crash
 * mid-way is completed by replaying the same event.
 */
export async function applyProviderEvent(sql: Sql, event: ProviderEvent): Promise<{ outcome: "processed" | "duplicate" | "ignored"; intent?: IntentRow; reason?: string }> {
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO payment_events (id, provider, event_id, event_type, payload_json, signature_valid, source, received_at)
    VALUES (${crypto.randomUUID()}, ${event.provider}, ${event.event_id}, ${event.type}, ${JSON.stringify(event.payload ?? {})},
            ${event.signature_valid}, ${event.source}, now())
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING id
  `;
  if (!inserted[0]) {
    const prior = (await sql<{ processed_at: Date | null }[]>`SELECT processed_at FROM payment_events WHERE provider = ${event.provider} AND event_id = ${event.event_id} LIMIT 1`)[0];
    if (prior?.processed_at) return { outcome: "duplicate" };
  }
  const markProcessed = (error = "") => sql`
    UPDATE payment_events SET processed_at = now(), error = ${error} WHERE provider = ${event.provider} AND event_id = ${event.event_id}
  `;

  const intent = (await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE provider_ref = ${event.provider_ref} AND provider = ${event.provider} LIMIT 1`)[0];
  if (!intent) {
    await markProcessed("unknown provider_ref");
    return { outcome: "ignored", reason: "unknown payment" };
  }

  if (event.type === "funding.failed") {
    await sql`UPDATE payment_intents SET status = 'failed', updated_at = now() WHERE id = ${intent.id} AND status = 'created'`;
    await markProcessed();
    return { outcome: "processed", intent };
  }

  // funding.succeeded
  if (!["created", "funded"].includes(intent.status)) {
    await markProcessed(`intent is ${intent.status}`);
    return { outcome: "ignored", intent, reason: `payment is ${intent.status}` };
  }
  const amount = Number(intent.amount_minor);
  const clientFee = Number(intent.client_fee_minor);
  await postEntry(sql, {
    idempotency_key: `funding:${intent.id}`,
    entry_type: "milestone.funded",
    description: `Milestone ${intent.milestone_index + 1} funded (${intent.provider_ref})`,
    mode: intent.mode,
    currency: intent.currency,
    contract_id: intent.contract_id,
    lines: [
      { account: accounts.clearing(intent.provider), direction: "debit", amount_minor: Number(intent.total_minor) },
      { account: accounts.fundsHeld(intent.contract_id), direction: "credit", amount_minor: amount },
      ...(clientFee > 0 ? [{ account: accounts.feesHeld(intent.contract_id), direction: "credit" as const, amount_minor: clientFee }] : [])
    ]
  });
  await sql.begin(async (tx) => {
    const updated = await tx<IntentRow[]>`
      UPDATE payment_intents SET status = 'funded', funded_at = now(), updated_at = now() WHERE id = ${intent.id} AND status = 'created' RETURNING *
    `;
    if (updated[0]) {
      const contract = (await tx<{ organization_id: string }[]>`SELECT organization_id FROM contracts WHERE id = ${intent.contract_id}`)[0];
      const version = (await tx<ContractVersionRow[]>`SELECT * FROM contract_versions WHERE contract_id = ${intent.contract_id} AND version = ${intent.contract_version}`)[0];
      const title = version ? contractVersionOut(version).milestones[intent.milestone_index]?.title ?? "Milestone" : "Milestone";
      await tx`
        INSERT INTO billing_invoices (id, number, mode, contract_id, payment_intent_id, organization_id, milestone_title, amount_minor, client_fee_minor, total_minor, currency, status, created_at)
        VALUES (${crypto.randomUUID()}, ${invoiceNumber(intent.mode)}, ${intent.mode}, ${intent.contract_id}, ${intent.id}, ${contract.organization_id},
                ${title.slice(0, 160)}, ${amount}, ${clientFee}, ${Number(intent.total_minor)}, ${intent.currency}, 'paid', now())
        ON CONFLICT (payment_intent_id) DO NOTHING
      `;
      await recordContractEvent(tx, intent.contract_id, null, "system", "milestone.funded", { milestone: intent.milestone_index, title, mode: intent.mode });
    }
  });
  await markProcessed();
  return { outcome: "processed", intent };
}

/** HMAC-SHA256 (hex) of the raw webhook body, compared in constant time. */
export async function verifyWebhookSignature(secret: string, rawBody: string, signatureHex: string): Promise<boolean> {
  if (!secret || !/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = signatureHex.toLowerCase();
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Release and refund                                                  */
/* ------------------------------------------------------------------ */

/**
 * Releases funds of an approved, funded milestone. Idempotent; safe to call repeatedly.
 * `staffDecision` is only for a staff dispute resolution (release without client approval).
 */
export async function releaseMilestone(
  sql: Sql,
  contractId: string,
  milestoneIndex: number,
  staffDecision?: { disputeId: string }
): Promise<"released" | "not_funded" | "not_approved" | "already"> {
  const intent = (await sql<IntentRow[]>`
    SELECT * FROM payment_intents WHERE contract_id = ${contractId} AND milestone_index = ${milestoneIndex} AND status IN ('funded', 'released')
    ORDER BY created_at DESC LIMIT 1
  `)[0];
  if (!intent) return "not_funded";
  if (intent.status === "released") return "already";
  const approved = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM milestone_submissions WHERE contract_id = ${contractId} AND milestone_index = ${milestoneIndex} AND status = 'approved'
  `;
  if ((approved[0]?.n ?? 0) === 0 && !staffDecision) return "not_approved";
  const contract = (await sql<{ freelancer_user_id: string }[]>`SELECT freelancer_user_id FROM contracts WHERE id = ${contractId}`)[0];
  const amount = Number(intent.amount_minor);
  const freelancerFee = Number(intent.freelancer_fee_minor);
  const clientFee = Number(intent.client_fee_minor);
  const lines = [
    { account: accounts.fundsHeld(contractId), direction: "debit" as const, amount_minor: amount },
    ...(amount - freelancerFee > 0 ? [{ account: accounts.freelancerPayable(contract.freelancer_user_id), direction: "credit" as const, amount_minor: amount - freelancerFee }] : []),
    ...(clientFee > 0 ? [{ account: accounts.feesHeld(contractId), direction: "debit" as const, amount_minor: clientFee }] : []),
    ...(freelancerFee + clientFee > 0 ? [{ account: accounts.feeRevenue(), direction: "credit" as const, amount_minor: freelancerFee + clientFee }] : [])
  ];
  await postEntry(sql, {
    idempotency_key: `release:${intent.id}`,
    entry_type: "milestone.released",
    description: staffDecision
      ? `Milestone ${milestoneIndex + 1}: funds released by dispute decision ${staffDecision.disputeId}`
      : `Milestone ${milestoneIndex + 1} approved: funds released`,
    mode: intent.mode,
    currency: intent.currency,
    contract_id: contractId,
    lines
  });
  const updated = await sql<{ id: string }[]>`
    UPDATE payment_intents SET status = 'released', released_at = now(), updated_at = now() WHERE id = ${intent.id} AND status = 'funded' RETURNING id
  `;
  if (updated[0]) {
    await recordContractEvent(sql, contractId, null, "system", "milestone.released", {
      milestone: milestoneIndex, amount_minor: amount - freelancerFee, mode: intent.mode, ...(staffDecision ? { dispute_id: staffDecision.disputeId } : {})
    });
  }
  return "released";
}

/** Refunds an unreleased funding (amount and client fee) to the client; cancels an unpaid checkout. */
export async function refundIntent(sql: Sql, intent: IntentRow, reason: string): Promise<"refunded" | "cancelled" | "not_refundable"> {
  if (intent.status === "created") {
    await sql`UPDATE payment_intents SET status = 'cancelled', updated_at = now() WHERE id = ${intent.id} AND status = 'created'`;
    return "cancelled";
  }
  if (intent.status !== "funded") return "not_refundable";
  const amount = Number(intent.amount_minor);
  const clientFee = Number(intent.client_fee_minor);
  await postEntry(sql, {
    idempotency_key: `refund:${intent.id}`,
    entry_type: "milestone.refunded",
    description: `Milestone ${intent.milestone_index + 1} refunded: ${reason}`.slice(0, 300),
    mode: intent.mode,
    currency: intent.currency,
    contract_id: intent.contract_id,
    lines: [
      { account: accounts.fundsHeld(intent.contract_id), direction: "debit", amount_minor: amount },
      ...(clientFee > 0 ? [{ account: accounts.feesHeld(intent.contract_id), direction: "debit" as const, amount_minor: clientFee }] : []),
      { account: accounts.clearing(intent.provider), direction: "credit", amount_minor: Number(intent.total_minor) }
    ]
  });
  const updated = await sql<{ id: string }[]>`
    UPDATE payment_intents SET status = 'refunded', refunded_at = now(), updated_at = now() WHERE id = ${intent.id} AND status = 'funded' RETURNING id
  `;
  if (updated[0]) {
    await sql`UPDATE billing_invoices SET status = 'refunded' WHERE payment_intent_id = ${intent.id}`;
    await recordContractEvent(sql, intent.contract_id, null, "system", "milestone.refunded", { milestone: intent.milestone_index, reason: reason.slice(0, 200), mode: intent.mode });
  }
  return "refunded";
}

/** Approved milestones whose release did not complete (e.g. a crash after approval). Run by the cron. */
export async function releasePendingApprovals(sql: Sql): Promise<number> {
  const rows = await sql<{ contract_id: string; milestone_index: number }[]>`
    SELECT DISTINCT i.contract_id, i.milestone_index
    FROM payment_intents i
    JOIN milestone_submissions s ON s.contract_id = i.contract_id AND s.milestone_index = i.milestone_index AND s.status = 'approved'
    WHERE i.status = 'funded'
    LIMIT 100
  `;
  let released = 0;
  for (const r of rows) if ((await releaseMilestone(sql, r.contract_id, Number(r.milestone_index))) === "released") released += 1;
  return released;
}

/* ------------------------------------------------------------------ */
/* Freelancer balance and payouts                                      */
/* ------------------------------------------------------------------ */

export async function payableBalance(sql: Queryable, userId: string, mode: PaymentMode, currency = "INR"): Promise<number> {
  const rows = await sql<{ debit: string | number; credit: string | number }[]>`
    SELECT COALESCE(sum(l.amount_minor) FILTER (WHERE l.direction = 'debit'), 0) AS debit,
           COALESCE(sum(l.amount_minor) FILTER (WHERE l.direction = 'credit'), 0) AS credit
    FROM ledger_lines l
    JOIN ledger_accounts a ON a.id = l.account_id
    JOIN ledger_entries e ON e.id = l.entry_id
    WHERE a.code = ${accounts.freelancerPayable(userId).code} AND l.currency = ${currency} AND e.mode = ${mode}
  `;
  return Number(rows[0]?.credit ?? 0) - Number(rows[0]?.debit ?? 0);
}

export type PayoutResult =
  | { ok: true; payout: { id: string; amount_minor: number; status: string; mode: PaymentMode; provider_ref: string | null }; duplicate: boolean }
  | { ok: false; code: "PAYMENTS_DISABLED" | "INSUFFICIENT_BALANCE" | "INVALID_AMOUNT"; message: string };

export async function requestPayout(env: Env, sql: Sql, userId: string, amountMinor: number, idempotencyKey: string): Promise<PayoutResult> {
  const state = await paymentsState(env, sql);
  if (!state.enabled) return { ok: false, code: "PAYMENTS_DISABLED", message: state.reason };
  if (!Number.isInteger(amountMinor) || amountMinor < 100) return { ok: false, code: "INVALID_AMOUNT", message: "Payouts start at ₹1." };
  const prior = (await sql<{ id: string; amount_minor: string | number; status: string; mode: PaymentMode; provider_ref: string | null; user_id: string }[]>`
    SELECT * FROM payouts WHERE idempotency_key = ${idempotencyKey} LIMIT 1
  `)[0];
  if (prior && prior.user_id === userId) {
    return { ok: true, payout: { id: prior.id, amount_minor: Number(prior.amount_minor), status: prior.status, mode: prior.mode, provider_ref: prior.provider_ref }, duplicate: true };
  }
  const id = crypto.randomUUID();
  const mode = state.mode;
  const providerName = state.provider.name;
  // One payout at a time per user: the balance check and the debit happen under the same lock.
  const reserved = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`payout:${userId}`}))`;
    const balance = await payableBalance(tx, userId, mode);
    if (amountMinor > balance) return false;
    await tx`
      INSERT INTO payouts (id, user_id, amount_minor, currency, provider, mode, status, idempotency_key, created_at)
      VALUES (${id}, ${userId}, ${amountMinor}, 'INR', ${providerName}, ${mode}, 'requested', ${idempotencyKey}, now())
    `;
    await postEntry(tx, {
      idempotency_key: `payout:${id}`,
      entry_type: "freelancer.payout",
      description: `Payout ${id}`,
      mode,
      currency: "INR",
      created_by: userId,
      lines: [
        { account: accounts.freelancerPayable(userId), direction: "debit", amount_minor: amountMinor },
        { account: accounts.clearing(providerName), direction: "credit", amount_minor: amountMinor }
      ]
    });
    return true;
  });
  if (!reserved) return { ok: false, code: "INSUFFICIENT_BALANCE", message: "The amount is more than your available balance." };
  const result = await state.provider.createPayout(id, amountMinor, "INR");
  await sql`
    UPDATE payouts SET status = ${result.status}, provider_ref = ${result.provider_ref}, paid_at = ${result.status === "paid" ? new Date().toISOString() : null}
    WHERE id = ${id}
  `;
  return { ok: true, payout: { id, amount_minor: amountMinor, status: result.status, mode: state.mode, provider_ref: result.provider_ref }, duplicate: false };
}
