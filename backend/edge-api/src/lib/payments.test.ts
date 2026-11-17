import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { accounts, applyProviderEvent, paymentsState, refundIntent, releaseMilestone, verifyWebhookSignature } from "./payments";
import type { IntentRow } from "./payments";
import { handlePaymentRoute } from "./payment-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

const env = {} as Env;

const INTENT: IntentRow = {
  id: "I1", contract_id: "K1", milestone_index: 0, contract_version: 1, amount_minor: "1000000", client_fee_minor: "35000",
  freelancer_fee_minor: "25000", total_minor: "1035000", currency: "INR", fee_schedule_id: "F1", provider: "sandbox",
  provider_ref: "sbx_pi_1", mode: "sandbox", status: "funded", created_by: "c1", created_at: new Date(), funded_at: new Date(), released_at: null, refunded_at: null
};

function ledgerLines(fake: ReturnType<typeof createFakeSql>) {
  return fake.queries.filter((q) => q.text.startsWith("INSERT INTO ledger_lines")).map((q) => [q.values[3], q.values[4]]);
}

describe("payment mode", () => {
  it("is off by default, sandbox when its flag is on, and never live without a live provider", async () => {
    const flags = (on: string[]) => createFakeSql((text, values) => (text.startsWith("SELECT enabled FROM feature_flags") ? [{ enabled: on.includes(String(values[0])) }] : [])).sql;
    expect((await paymentsState(env, flags([]))).enabled).toBe(false);
    expect(await paymentsState(env, flags(["payments.sandbox"]))).toMatchObject({ enabled: true, mode: "sandbox" });
    const live = await paymentsState(env, flags(["payments.live", "payments.sandbox"]));
    expect(live.enabled).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("accepts only the HMAC-SHA256 of the raw body with the configured secret", async () => {
    const body = '{"id":"ev1"}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyWebhookSignature("secret", body, sig)).toBe(true);
    expect(await verifyWebhookSignature("secret", body + " ", sig)).toBe(false);
    expect(await verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(await verifyWebhookSignature("", body, sig)).toBe(false);
    expect(await verifyWebhookSignature("secret", body, "nothex")).toBe(false);
  });

  it("rejects webhooks for the sandbox or without a configured secret, and bad signatures", async () => {
    const fake = createFakeSql(() => []);
    const deps = { database: () => fake.sql, authenticate: async () => new Response(null, { status: 401 }) };
    expect((await handlePaymentRoute(new Request("https://x/api/v1/payments/webhooks/sandbox", { method: "POST", body: "{}" }), { PAYMENT_WEBHOOK_SECRET: "s" } as Env, "r", deps))!.status).toBe(404);
    expect((await handlePaymentRoute(new Request("https://x/api/v1/payments/webhooks/razorpay", { method: "POST", body: "{}" }), env, "r", deps))!.status).toBe(404);
    expect((await handlePaymentRoute(new Request("https://x/api/v1/payments/webhooks/razorpay", { method: "POST", body: "{}", headers: { "X-Signature": "a".repeat(64) } }), { PAYMENT_WEBHOOK_SECRET: "s" } as Env, "r", deps))!.status).toBe(401);
  });
});

describe("ledger postings", () => {
  it("funding: provider clearing receives amount + client fee; amount and fee are held", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("INSERT INTO payment_events")) return [{ id: "E" }];
      if (text.startsWith("SELECT * FROM payment_intents WHERE provider_ref")) return [{ ...INTENT, status: "created" }];
      if (text.startsWith("INSERT INTO ledger_entries")) return [{ id: "LE" }];
      if (text.startsWith("INSERT INTO ledger_accounts")) return [{ id: "acct" }];
      if (text.startsWith("UPDATE payment_intents SET status = 'funded'")) return [{ ...INTENT }];
      if (text.startsWith("SELECT organization_id FROM contracts")) return [{ organization_id: "o1" }];
      return [];
    });
    const result = await applyProviderEvent(fake.sql, { provider: "sandbox", event_id: "ev", type: "funding.succeeded", provider_ref: "sbx_pi_1", source: "sandbox", signature_valid: true, payload: {} });
    expect(result.outcome).toBe("processed");
    expect(ledgerLines(fake)).toEqual([["debit", 1_035_000], ["credit", 1_000_000], ["credit", 35_000]]);
    expect(fake.queries.some((q) => q.text.startsWith("INSERT INTO billing_invoices"))).toBe(true);
  });

  it("a processed event is not applied twice", async () => {
    const fake = createFakeSql((text) => (text.startsWith("SELECT processed_at FROM payment_events") ? [{ processed_at: new Date() }] : []));
    expect((await applyProviderEvent(fake.sql, { provider: "sandbox", event_id: "ev", type: "funding.succeeded", provider_ref: "x", source: "sandbox", signature_valid: true, payload: {} })).outcome).toBe("duplicate");
    expect(fake.queries.some((q) => q.text.startsWith("INSERT INTO ledger"))).toBe(false);
  });

  it("release: freelancer gets amount − freelancer fee, platform gets both fees", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT * FROM payment_intents WHERE contract_id")) return [INTENT];
      if (text.startsWith("SELECT count(*)::int AS n FROM milestone_submissions")) return [{ n: 1 }];
      if (text.startsWith("SELECT freelancer_user_id FROM contracts")) return [{ freelancer_user_id: "f1" }];
      if (text.startsWith("INSERT INTO ledger_entries")) return [{ id: "LE" }];
      if (text.startsWith("INSERT INTO ledger_accounts")) return [{ id: "acct" }];
      if (text.startsWith("UPDATE payment_intents SET status = 'released'")) return [{ id: "I1" }];
      return [];
    });
    expect(await releaseMilestone(fake.sql, "K1", 0)).toBe("released");
    expect(ledgerLines(fake)).toEqual([["debit", 1_000_000], ["credit", 975_000], ["debit", 35_000], ["credit", 60_000]]);
    const notApproved = createFakeSql((text) => (text.startsWith("SELECT * FROM payment_intents") ? [INTENT] : text.startsWith("SELECT count") ? [{ n: 0 }] : []));
    expect(await releaseMilestone(notApproved.sql, "K1", 0)).toBe("not_approved");
  });

  it("refund returns amount and client fee to the provider; released funds cannot be refunded", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("INSERT INTO ledger_entries")) return [{ id: "LE" }];
      if (text.startsWith("INSERT INTO ledger_accounts")) return [{ id: "acct" }];
      if (text.startsWith("UPDATE payment_intents SET status = 'refunded'")) return [{ id: "I1" }];
      return [];
    });
    expect(await refundIntent(fake.sql, INTENT, "test")).toBe("refunded");
    expect(ledgerLines(fake)).toEqual([["debit", 1_000_000], ["debit", 35_000], ["credit", 1_035_000]]);
    expect(await refundIntent(createFakeSql(() => []).sql, { ...INTENT, status: "released" }, "x")).toBe("not_refundable");
  });

  it("names accounts per contract and per freelancer", () => {
    expect(accounts.fundsHeld("K1").code).toBe("funds_held:contract:K1");
    expect(accounts.freelancerPayable("f1")).toMatchObject({ kind: "liability", owner_id: "f1" });
  });
});

describe("payment routes", () => {
  it("needs an idempotency key for payouts and the marketplace flag", async () => {
    const fake = createFakeSql((text) => (text.startsWith("SELECT enabled FROM feature_flags") ? [{ enabled: true }] : []));
    const deps = { database: () => fake.sql, authenticate: async () => ({ user: { id: "f1", email: "", email_verified: true, mfa_enabled: false }, claims: { sub: "f1", jti: "j", iat: 0, exp: 0 } }) };
    const r = await handlePaymentRoute(jsonRequest("POST", "/api/v1/me/payouts", { amount_minor: 100 }), env, "r", deps);
    expect((await readJson(r!)).error!.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});
