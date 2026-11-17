import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { MAX_AMOUNT_MINOR, contractActions, termsHash, validateProposal, validateTerms } from "./contracts";
import type { ContractRow, ContractVersionRow } from "./contracts";
import { handleHiringRoute } from "./hiring-routes";
import type { HiringRouteDeps } from "./hiring-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const NOW = new Date("2026-11-17T10:00:00Z");
const COVER = "I have built three bakery ordering sites with Next.js and can deliver in three weeks with tests.";
const TERMS = {
  title: "Bakery ordering website",
  scope: "Build and launch",
  deliverables: ["Order form"],
  milestones: [{ title: "Design", amount_minor: 1_200_000, due_date: "2026-12-15" }, { title: "Build", amount_minor: 2_000_000 }],
  revision_rounds: 2,
  acceptance_criteria: ["Orders arrive"]
};

describe("proposal validation", () => {
  it("accepts a proposal with a freelancer-set price in minor units", () => {
    expect(validateProposal({ cover_letter: COVER, price_minor: 3_000_000, estimated_days: 21 })).toEqual({ ok: true, value: { cover_letter: COVER, price_minor: 3_000_000, estimated_days: 21 } });
  });

  it("rejects short letters, fractional or zero prices, bad estimates and off-platform contact", () => {
    const bad = validateProposal({ cover_letter: "hi", price_minor: 10.5, estimated_days: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["cover_letter", "estimated_days", "price_minor"]);
    const contact = validateProposal({ cover_letter: `${COVER} Email me at me@example.com`, price_minor: 100 });
    expect(contact.ok).toBe(false);
  });
});

describe("contract terms", () => {
  it("computes the total from milestone amounts (never from input)", () => {
    const result = validateTerms({ ...TERMS, total_minor: 1 }, "INR", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total_minor).toBe(3_200_000);
      expect(result.value.milestones[1]).toEqual({ title: "Build", amount_minor: 2_000_000, due_date: null });
    }
  });

  it("reports per-milestone errors, past dates, wrong currency and missing milestones", () => {
    const result = validateTerms({ ...TERMS, currency: "USD", milestones: [{ title: "", amount_minor: 0, due_date: "2026-01-01" }] }, "INR", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["currency", "milestones.0.amount_minor", "milestones.0.due_date", "milestones.0.title"]);
    const none = validateTerms({ ...TERMS, milestones: [] }, "INR", NOW);
    expect(none.ok).toBe(false);
  });

  it("rejects amounts above the cap and off-platform payment terms", () => {
    expect(validateTerms({ ...TERMS, milestones: [{ title: "All", amount_minor: MAX_AMOUNT_MINOR + 1 }] }, "INR", NOW).ok).toBe(false);
    const offPlatform = validateTerms({ ...TERMS, scope: "Pay outside the platform in USDT" }, "INR", NOW);
    expect(offPlatform.ok).toBe(false);
    if (!offPlatform.ok) expect(Object.keys(offPlatform.errors)).toEqual(["terms"]);
  });

  it("hashes identical terms identically", async () => {
    const a = validateTerms(TERMS, "INR", NOW);
    const b = validateTerms({ ...TERMS }, "INR", NOW);
    if (a.ok && b.ok) expect(await termsHash(a.value)).toBe(await termsHash(b.value));
  });

  it("offers each party only the actions it may take", () => {
    const contract = { status: "offered" } as ContractRow;
    const clientProposed = { client_accepted_at: NOW, freelancer_accepted_at: null } as ContractVersionRow;
    expect(contractActions(contract, clientProposed, "client", true)).toEqual(["propose_changes", "withdraw"]);
    expect(contractActions(contract, clientProposed, "client", false)).toEqual([]);
    expect(contractActions(contract, clientProposed, "freelancer", true)).toEqual(["accept", "propose_changes", "decline"]);
    expect(contractActions({ status: "active" } as ContractRow, clientProposed, "freelancer", true)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

interface World {
  user?: string;
  flag?: boolean;
  roles?: string[];
  membership?: string | null;
  listing?: Record<string, unknown> | null;
  insertReturns?: boolean;
  proposal?: Record<string, unknown> | null;
  contract?: Record<string, unknown> | null;
  version?: Record<string, unknown> | null;
}

function world(opts: World = {}) {
  const contract = opts.contract === undefined
    ? { id: "K1", listing_id: "L1", proposal_id: "P1", organization_id: "o1", freelancer_user_id: "f1", status: "offered", current_version: 1, created_at: NOW, updated_at: NOW, activated_at: null }
    : opts.contract;
  const version = opts.version === undefined
    ? { version: 1, title: "T", scope: "", deliverables_json: "[]", milestones_json: "[]", total_minor: "100", currency: "INR", revision_rounds: 2, acceptance_json: "[]", ownership_terms: "", content_hash: "h", proposed_by: "client", created_at: NOW, client_accepted_at: NOW, freelancer_accepted_at: null }
    : opts.version;
  const fake = createFakeSql((text, values) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: opts.flag ?? true }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return (opts.roles ?? ["freelancer", "client"]).map((role) => ({ role, status: "active" }));
    if (text.includes("FROM organization_memberships m JOIN organizations o")) {
      return opts.membership === null || opts.membership === undefined && (opts.user ?? "c1") !== "c1" ? [] : [{ id: "o1", name: "Acme", status: "active", membership_role: opts.membership ?? "owner" }];
    }
    if (text.startsWith("SELECT l.*, v.budget_model, v.currency")) {
      return opts.listing === null ? [] : [{ id: "L1", organization_id: "o1", status: "published", visibility: "public", closes_at: null, budget_model: "fixed", currency: "INR", invitation_id: null, is_member: false, ...(opts.listing ?? {}) }];
    }
    if (text.startsWith("INSERT INTO listing_proposals")) {
      return opts.insertReturns === false ? [] : [{ id: "P1", listing_id: values[1], freelancer_user_id: values[2], invitation_id: values[3], status: "submitted", cover_letter: values[4], price_minor: values[5], currency: values[6], budget_model: values[7], estimated_days: values[8], created_at: NOW, updated_at: NOW, decided_at: null }];
    }
    if (text.startsWith("SELECT p.*, l.organization_id, l.status AS listing_status")) {
      return opts.proposal === null ? [] : [{ id: "P1", listing_id: "L1", freelancer_user_id: "f1", status: "shortlisted", organization_id: "o1", listing_status: "published", listing_currency: "INR", price_minor: "100", created_at: NOW, updated_at: NOW, ...(opts.proposal ?? {}) }];
    }
    if (text.startsWith("SELECT * FROM listing_proposals WHERE id = $ FOR UPDATE")) {
      return opts.proposal === null ? [] : [{ id: "P1", listing_id: "L1", freelancer_user_id: "f1", status: "shortlisted", price_minor: "100", created_at: NOW, updated_at: NOW, ...(opts.proposal ?? {}) }];
    }
    if (text.startsWith("SELECT * FROM contracts WHERE id = $")) return contract ? [contract] : [];
    if (text.startsWith("SELECT * FROM contract_versions WHERE contract_id = $ AND version")) return version ? [version] : [];
    if (text.startsWith("SELECT * FROM contract_versions WHERE contract_id")) return version ? [version] : [];
    if (text.startsWith("UPDATE contracts SET status = $")) return contract && contract.status === "offered" ? [{ ...contract, status: values[0] }] : [];
    return [];
  });
  const deps: HiringRouteDeps = { database: () => fake.sql, authenticate: async () => session(opts.user ?? "c1"), now: () => NOW };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: HiringRouteDeps, method: string, path: string, payload?: unknown) => handleHiringRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("hiring routes", () => {
  it("leaves the existing external-proposal routes alone", async () => {
    const { deps } = world();
    expect(await call(deps, "PUT", "/api/v1/proposals/abc", {})).toBeNull();
    expect(await call(deps, "POST", "/api/v1/proposals/abc/request-approval")).toBeNull();
    expect(await call(deps, "GET", "/api/v1/proposals")).toBeNull();
  });

  it("is closed while the client-side flag is off", async () => {
    const { deps } = world({ flag: false });
    expect((await call(deps, "GET", "/api/v1/contracts"))!.status).toBe(403);
  });

  it("lets a freelancer propose once on a published public listing", async () => {
    const { deps, fake } = world({ user: "f1" });
    const response = await call(deps, "POST", "/api/v1/marketplace/listings/L1/proposals", { cover_letter: COVER, price_minor: 3_000_000, estimated_days: 21 });
    expect(response!.status).toBe(201);
    expect((await readJson(response!)).data).toMatchObject({ status: "submitted", price_minor: 3_000_000, currency: "INR", invited: false });
    expect(fake.queries.find((q) => q.text.startsWith("INSERT INTO listing_proposals"))!.text).toContain("ON CONFLICT (listing_id, freelancer_user_id) DO NOTHING");
    const again = world({ user: "f1", insertReturns: false });
    expect((await readJson((await call(again.deps, "POST", "/api/v1/marketplace/listings/L1/proposals", { cover_letter: COVER, price_minor: 100 }))!)).error!.code).toBe("ALREADY_PROPOSED");
  });

  it("hides invite-only listings from uninvited freelancers and the client's own members, and refuses closed ones", async () => {
    const cases: Array<[World, number]> = [
      [{ user: "f1", listing: { visibility: "invite_only" } }, 404],
      [{ user: "f1", listing: { is_member: true } }, 404],
      [{ user: "f1", listing: { status: "closed" } }, 409],
      [{ user: "f1", listing: { closes_at: new Date("2026-11-01") } }, 409],
      [{ user: "f1", roles: ["client"] }, 403]
    ];
    for (const [opts, status] of cases) {
      const { deps } = world(opts);
      expect((await call(deps, "POST", "/api/v1/marketplace/listings/L1/proposals", { cover_letter: COVER, price_minor: 100 }))!.status).toBe(status);
    }
    const invited = world({ user: "f1", listing: { visibility: "invite_only", invitation_id: "i1" } });
    const response = await call(invited.deps, "POST", "/api/v1/marketplace/listings/L1/proposals", { cover_letter: COVER, price_minor: 100 });
    expect(response!.status).toBe(201);
    expect(invited.fake.queries.some((q) => q.text.startsWith("UPDATE listing_invitations SET status = 'accepted'"))).toBe(true);
  });

  it("lets only the proposal's freelancer edit or withdraw it", async () => {
    const other = world({ user: "f9" });
    expect((await call(other.deps, "POST", "/api/v1/listing-proposals/P1/withdraw"))!.status).toBe(404);
    const offered = world({ user: "f1", proposal: { status: "offered" } });
    expect((await call(offered.deps, "PUT", "/api/v1/listing-proposals/P1", { cover_letter: COVER, price_minor: 100 }))!.status).toBe(409);
  });

  it("requires owner/admin for client decisions and offers", async () => {
    const member = world({ membership: "member" });
    expect((await call(member.deps, "POST", "/api/v1/listing-proposals/P1/status", { action: "shortlist" }))!.status).toBe(403);
    expect((await call(member.deps, "POST", "/api/v1/listing-proposals/P1/offer", { terms: TERMS }))!.status).toBe(403);
    const outsider = world({ membership: null });
    expect((await call(outsider.deps, "POST", "/api/v1/listing-proposals/P1/offer", { terms: TERMS }))!.status).toBe(404);
  });

  it("creates an offer as contract version 1 accepted by the client, in one transaction", async () => {
    const { deps, fake } = world();
    const response = await call(deps, "POST", "/api/v1/listing-proposals/P1/offer", { terms: TERMS });
    expect(response!.status).toBe(201);
    const inserts = fake.queries.filter((q) => q.text.startsWith("INSERT INTO contract") || q.text.startsWith("UPDATE listing_proposals SET status = 'offered'"));
    expect(inserts).toHaveLength(4);
    expect(inserts.map((q) => q.text.match(/^(?:INSERT INTO|UPDATE) (\w+)/)![1])).toEqual(["contracts", "contract_versions", "listing_proposals", "contract_events"]);
    expect(inserts.every((q) => q.inTransaction)).toBe(true);
    const version = fake.queries.find((q) => q.text.startsWith("INSERT INTO contract_versions"))!;
    expect(version.values).toContain(3_200_000);
    expect(version.values).toContain("client");
    const json = await readJson(response!);
    expect(json.data.funding.available).toBe(false);
    expect(json.data.funding.message).toContain("not available");
  });

  it("activates only when both parties accepted the same version, and marks the listing as hiring", async () => {
    const { deps, fake } = world({ user: "f1" });
    const response = await call(deps, "POST", "/api/v1/contracts/K1/accept", { version: 1 });
    expect(response!.status).toBe(200);
    expect((await readJson(response!)).message).toContain("Both parties accepted");
    const texts = fake.queries.filter((q) => q.inTransaction).map((q) => q.text);
    expect(texts.some((t) => t.startsWith("UPDATE contracts SET status = 'active'"))).toBe(true);
    expect(texts.some((t) => t.startsWith("UPDATE listing_proposals SET status = 'hired'"))).toBe(true);
    expect(texts.some((t) => t.startsWith("UPDATE project_listings SET status = 'hiring'"))).toBe(true);

    const waiting = world({ user: "f1", version: { version: 1, client_accepted_at: null, freelancer_accepted_at: null, content_hash: "h", created_at: NOW, milestones_json: "[]", deliverables_json: "[]", acceptance_json: "[]", total_minor: "1" } });
    const pending = await call(waiting.deps, "POST", "/api/v1/contracts/K1/accept", { version: 1 });
    expect((await readJson(pending!)).message).toContain("Waiting for the other party");
    expect(waiting.fake.queries.some((q) => q.text.startsWith("UPDATE contracts SET status = 'active'"))).toBe(false);
  });

  it("rejects stale or repeated acceptance, and actions by the wrong party", async () => {
    const stale = world({ user: "f1" });
    expect((await readJson((await call(stale.deps, "POST", "/api/v1/contracts/K1/accept", { version: 2 }))!)).error!.code).toBe("VERSION_CONFLICT");
    const again = world({ user: "c1" });
    expect((await readJson((await call(again.deps, "POST", "/api/v1/contracts/K1/accept", { version: 1 }))!)).error!.code).toBe("ALREADY_ACCEPTED");
    const clientDecline = world({ user: "c1" });
    expect((await call(clientDecline.deps, "POST", "/api/v1/contracts/K1/decline"))!.status).toBe(403);
    const freelancerWithdraw = world({ user: "f1" });
    expect((await call(freelancerWithdraw.deps, "POST", "/api/v1/contracts/K1/withdraw"))!.status).toBe(403);
    const stranger = world({ user: "f9", membership: null });
    expect((await call(stranger.deps, "GET", "/api/v1/contracts/K1"))!.status).toBe(404);
  });

  it("records a counter-proposal as a new version accepted only by its proposer", async () => {
    const { deps, fake } = world({ user: "f1" });
    const response = await call(deps, "POST", "/api/v1/contracts/K1/versions", { base_version: 1, terms: TERMS });
    expect(response!.status).toBe(201);
    const insert = fake.queries.find((q) => q.text.startsWith("INSERT INTO contract_versions"))!;
    expect(insert.values[2]).toBe(2);
    expect(insert.values).toContain("freelancer");
    expect(fake.queries.some((q) => q.text.startsWith("UPDATE contracts SET current_version"))).toBe(true);
  });
});
