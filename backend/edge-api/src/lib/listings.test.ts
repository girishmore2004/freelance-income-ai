import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { briefHash, canTransition, publicListingOut, publicationGaps, screenBrief, validateBrief } from "./listings";
import type { Brief, ListingRow, VersionRow } from "./listings";
import { buildBrief, parseModelDraft, templateDraft } from "./brief-builder";
import type { CategoryTemplate } from "./brief-builder";
import { handleListingRoute } from "./listing-routes";
import type { ListingRouteDeps } from "./listing-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const CATS = new Set(["website_development"]);
const TODAY = new Date("2026-11-17T10:00:00Z");

const COMPLETE = {
  title: "Website for a handmade goods shop",
  category_slug: "website_development",
  outcome: "Customers can browse products and place orders online.",
  deliverables: ["Five-page website", "Product catalogue"],
  skills: ["Next.js", "Payments"],
  acceptance_criteria: ["All agreed pages exist", "Checkout works end to end"],
  budget_min_minor: 2_500_000,
  budget_max_minor: 5_000_000,
  deadline: "2026-12-31",
  milestones: [{ title: "Design", description: "Wireframes" }]
};

function brief(overrides: Record<string, unknown> = {}): Brief {
  const result = validateBrief({ ...COMPLETE, ...overrides }, CATS, TODAY);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.brief;
}

describe("brief validation and publication rules", () => {
  it("accepts a complete brief and applies safe defaults", () => {
    const b = brief();
    expect(b).toMatchObject({ currency: "INR", budget_model: "fixed", revision_rounds: 2, visibility: "public", confidentiality: "standard", languages: ["en"] });
    expect(publicationGaps(b)).toEqual([]);
  });

  it("reports every invalid field", () => {
    const result = validateBrief(
      { title: "x", category_slug: "plumbing", budget_min_minor: 500, budget_max_minor: 100, deadline: "2026-01-01", currency: "rupees", visibility: "everyone", revision_rounds: 50, budget_model: "per word" },
      CATS,
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["budget_max_minor", "budget_model", "category_slug", "currency", "deadline", "revision_rounds", "title", "visibility"]);
    }
  });

  it("rejects non-integer money (minor units only) and impossible dates", () => {
    const result = validateBrief({ ...COMPLETE, budget_min_minor: 99.5, deadline: "2026-02-30" }, CATS, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["budget_min_minor", "deadline"]);
  });

  it("lets drafts be incomplete but lists what blocks submission", () => {
    const draft = brief({ outcome: "", deliverables: [], skills: [], acceptance_criteria: [], budget_min_minor: null, budget_max_minor: null, deadline: null });
    expect(publicationGaps(draft)).toHaveLength(6);
  });

  it("hashes content deterministically and ignores visibility", async () => {
    expect(await briefHash(brief())).toBe(await briefHash(brief({ visibility: "private" })));
    expect(await briefHash(brief())).not.toBe(await briefHash(brief({ title: "A different website project" })));
  });

  it("allows only the documented lifecycle transitions", () => {
    expect(canTransition("draft", "submit")).toBe(true);
    expect(canTransition("published", "submit")).toBe(false);
    expect(canTransition("published", "pause")).toBe(true);
    expect(canTransition("paused", "resume")).toBe(true);
    expect(canTransition("closed", "resume")).toBe(false);
    expect(canTransition("cancelled", "close")).toBe(false);
  });
});

describe("listing screen", () => {
  it("passes an ordinary brief", () => {
    expect(screenBrief(brief())).toEqual([]);
  });

  it("flags off-platform contact, upfront fees, prohibited work and shorteners", () => {
    const codes = (o: Record<string, unknown>) => screenBrief(brief(o)).map((f) => f.code);
    expect(codes({ outcome: "Message me on WhatsApp for details about the shop" })).toEqual(["off_platform_contact"]);
    expect(codes({ outcome: "Pay a registration fee of 500 before you apply" })).toEqual(["upfront_fee"]);
    expect(codes({ outcome: "Need someone to take my exam online next week" })).toEqual(["prohibited_work"]);
    expect(codes({ outcome: "Buy reviews for my product listing quickly" })).toEqual(["prohibited_work"]);
    expect(codes({ description: "Details at bit.ly/abc123" })).toEqual(["link_shortener"]);
  });
});

describe("public projection", () => {
  const listing: ListingRow = { id: "L1", organization_id: "o1", category_slug: "website_development", status: "published", visibility: "public", moderation_status: "passed", moderation_notes: "", current_version: 1, published_at: new Date("2026-11-17T00:00:00Z"), closes_at: null, created_at: new Date(), updated_at: new Date() };
  const version = (confidentiality: string): VersionRow => ({
    version: 1, title: "Shop website", category_slug: "website_development", outcome: "Sell online", description: "Long private detail",
    deliverables_json: '["Site"]', skills_json: '["Next.js"]', experience_level: "any", budget_model: "fixed", budget_min_minor: "100",
    budget_max_minor: "200", currency: "INR", deadline: "2026-12-31", milestones_json: '[{"title":"Design","description":"x"}]',
    acceptance_json: '["Works"]', revision_rounds: 2, languages_json: '["en"]', timezone: "", confidentiality,
    ownership_notes: "Internal licence note", assumptions_json: '["Client hosts"]', content_hash: "h", created_at: new Date()
  });

  it("never exposes ownership notes, assumptions or organisation ids", () => {
    const out = publicListingOut(listing, version("standard"), "Acme Studio");
    const json = JSON.stringify(out);
    expect(json).not.toContain("Internal licence note");
    expect(json).not.toContain("Client hosts");
    expect(json).not.toContain("o1");
    expect(out).toMatchObject({ client_name: "Acme Studio", budget_min_minor: 100, budget_max_minor: 200, milestones: ["Design"] });
  });

  it("hides the client name and description for confidential briefs", () => {
    const out = publicListingOut(listing, version("confidential"), "Acme Studio");
    expect(out.client_name).toBe("Confidential client");
    expect(out.description).toBe("");
  });
});

describe("Brief Builder (C1)", () => {
  const template: CategoryTemplate = { inputs: ["Pages", "Integrations", "Hosting and domain ownership"], stages: ["Discovery", "Design", "Build"], acceptance: ["Agreed pages exist"], default_revisions: 2 };
  const allowEnv = (response: string) =>
    ({ AI: { run: vi.fn(async () => ({ response })) } }) as unknown as Env;
  const usage = () =>
    createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
      if (text.startsWith("SELECT count(*) FILTER")) return [{ user_day: "0", user_month: "0", global_day_micros: "0" }];
      return [];
    });
  const notes = "We sell handmade candles and need a small website with a shop. We already have pages written.";

  it("builds a template draft that asks only about missing inputs", () => {
    const draft = templateDraft(notes, "Website development", template);
    expect(draft.milestones.map((m) => m.title)).toEqual(["Discovery", "Design", "Build"]);
    expect(draft.questions.some((q) => q.startsWith("Integrations"))).toBe(true);
    expect(draft.questions.some((q) => q.startsWith("Pages"))).toBe(false);
  });

  it("uses a clean model draft", async () => {
    const reply = JSON.stringify({ title: "Candle shop website", outcome: "Sell candles online", deliverables: ["Shop pages"], skills: ["Shopify"], milestones: [{ title: "Design", description: "Layout" }], acceptance_criteria: ["Orders can be placed"], assumptions: ["Client provides photos"], questions: ["Which payment provider?"], conflicts: [] });
    const result = await buildBrief(allowEnv(reply), usage().sql, "u1", { notes, categoryName: "Website development", template });
    expect(result.source).toBe("model");
    expect(result.draft.title).toBe("Candle shop website");
    expect(result.draft).not.toHaveProperty("budget_min_minor");
  });

  it("discards a model draft that invents a budget or a timeline", async () => {
    const priced = JSON.stringify({ title: "Shop", outcome: "Budget around ₹40,000 should be enough", deliverables: [], acceptance_criteria: [] });
    const r1 = await buildBrief(allowEnv(priced), usage().sql, "u1", { notes, categoryName: "Website development", template });
    expect(r1.source).toBe("template");
    expect(r1.note).toContain("price");

    const dated = JSON.stringify({ title: "Shop", outcome: "Deliver within 10 days", deliverables: [], acceptance_criteria: [] });
    const r2 = await buildBrief(allowEnv(dated), usage().sql, "u1", { notes, categoryName: "Website development", template });
    expect(r2.source).toBe("template");
    expect(r2.note).toContain("dates");
  });

  it("falls back when the reply is not JSON or the quota is used up", async () => {
    expect(parseModelDraft("Sure! Here is your brief.", templateDraft(notes, "W", template))).toBeNull();
    const r = await buildBrief(allowEnv("not json"), usage().sql, "u1", { notes, categoryName: "Website development", template });
    expect(r.source).toBe("template");
    const exhausted = createFakeSql((text) => (text.startsWith("SELECT enabled") ? [{ enabled: true }] : text.startsWith("SELECT count(*) FILTER") ? [{ user_day: "20", user_month: "20", global_day_micros: "0" }] : []));
    const run = vi.fn(async () => ({ response: "{}" }));
    const r3 = await buildBrief({ AI: { run } } as unknown as Env, exhausted.sql, "u1", { notes, categoryName: "Website development", template });
    expect(r3.source).toBe("template");
    expect(run).toHaveBeenCalledTimes(0);
  });
});

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

function session(userId = "u1"): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

const STORED_VERSION: VersionRow = {
  version: 1, title: COMPLETE.title, category_slug: "website_development", outcome: COMPLETE.outcome, description: "",
  deliverables_json: JSON.stringify(COMPLETE.deliverables), skills_json: JSON.stringify(COMPLETE.skills), experience_level: "any",
  budget_model: "fixed", budget_min_minor: "2500000", budget_max_minor: "5000000", currency: "INR", deadline: "2026-12-31",
  milestones_json: "[]", acceptance_json: JSON.stringify(COMPLETE.acceptance_criteria), revision_rounds: 2, languages_json: '["en"]',
  timezone: "", confidentiality: "standard", ownership_notes: "", assumptions_json: "[]", content_hash: "h1", created_at: new Date()
};

function world(opts: { flag?: boolean; roles?: string[]; membership?: string | null; status?: string; currentVersion?: number; version?: Partial<VersionRow> } = {}) {
  const listing: ListingRow = {
    id: "L1", organization_id: "o1", category_slug: "website_development", status: opts.status ?? "draft", visibility: "public",
    moderation_status: "not_screened", moderation_notes: "", current_version: opts.currentVersion ?? 1, published_at: null, closes_at: null,
    created_at: new Date(), updated_at: new Date()
  };
  const version = { ...STORED_VERSION, ...(opts.version ?? {}) };
  const fake = createFakeSql((text, values) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: opts.flag ?? true }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return (opts.roles ?? ["freelancer", "client"]).map((role) => ({ role, status: "active" }));
    if (text.includes("FROM organization_memberships m JOIN organizations o")) {
      return opts.membership === null ? [] : [{ id: "o1", name: "Acme", status: "active", membership_role: opts.membership ?? "owner" }];
    }
    if (text.startsWith("SELECT slug, name, description, template_json FROM project_categories")) {
      return [{ slug: "website_development", name: "Website development", description: "", template_json: '{"inputs":[],"stages":["Build"],"acceptance":["Works"],"default_revisions":2}' }];
    }
    if (text.startsWith("SELECT * FROM project_listings")) return [listing];
    if (text.startsWith("SELECT * FROM project_listing_versions")) return [version];
    if (text.startsWith("UPDATE project_listings SET status = 'published'")) { listing.status = "published"; return []; }
    if (text.startsWith("UPDATE project_listings SET status = 'in_review'")) { listing.status = "in_review"; listing.moderation_status = "flagged"; return []; }
    if (text.startsWith("UPDATE project_listings SET status = $")) { listing.status = String(values[0]); return []; }
    if (text.startsWith("UPDATE project_listings SET current_version")) { listing.current_version = Number(values[0]); listing.status = String(values[3]); return []; }
    return [];
  });
  const deps: ListingRouteDeps = { database: () => fake.sql, authenticate: async () => session(), buildBrief: vi.fn() as unknown as ListingRouteDeps["buildBrief"] };
  return { fake, deps, listing };
}

const env = {} as Env;

describe("listing routes", () => {
  it("is closed while the client-side flag is off (even the marketplace)", async () => {
    const { deps } = world({ flag: false });
    for (const path of ["/api/v1/project-categories", "/api/v1/marketplace/listings", "/api/v1/organizations/o1/listings"]) {
      const response = await handleListingRoute(jsonRequest("GET", path), env, "r", deps);
      expect(response!.status).toBe(403);
    }
  });

  it("requires the client role for organisation endpoints", async () => {
    const { deps } = world({ roles: ["freelancer"] });
    const response = await handleListingRoute(jsonRequest("GET", "/api/v1/organizations/o1/listings"), env, "r", deps);
    expect((await readJson(response!)).error?.code).toBe("CLIENT_ROLE_REQUIRED");
  });

  it("returns 404 to non-members for listings and the brief assistant", async () => {
    const { deps, fake } = world({ membership: null });
    for (const [method, path, payload] of [
      ["GET", "/api/v1/listings/L1", undefined],
      ["PUT", "/api/v1/listings/L1", { ...COMPLETE, base_version: 1 }],
      ["POST", "/api/v1/listings/L1/transition", { action: "submit" }],
      ["POST", "/api/v1/organizations/o1/listings", COMPLETE],
      ["POST", "/api/v1/organizations/o1/brief-assistant", { category_slug: "website_development", notes: "x".repeat(40) }]
    ] as const) {
      const response = await handleListingRoute(jsonRequest(method, path, payload), env, "r", deps);
      expect(response!.status).toBe(404);
    }
    expect(fake.queries.some((q) => /^(INSERT|UPDATE)/.test(q.text))).toBe(false);
  });

  it("creates a draft listing and version 1 in one transaction", async () => {
    const { deps, fake } = world();
    const response = await handleListingRoute(jsonRequest("POST", "/api/v1/organizations/o1/listings", COMPLETE), env, "r", deps);
    expect(response!.status).toBe(201);
    const inserts = fake.queries.filter((q) => q.text.startsWith("INSERT INTO project_listing"));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((q) => q.inTransaction)).toBe(true);
    expect(inserts[0].text).toContain("'draft'");
    expect(inserts[0].values).toEqual(expect.arrayContaining(["o1", "u1", "website_development", "public"]));
  });

  it("refuses to submit an incomplete brief and lists the gaps", async () => {
    const { deps } = world({ version: { budget_min_minor: null, budget_max_minor: null, deadline: null } });
    const response = await handleListingRoute(jsonRequest("POST", "/api/v1/listings/L1/transition", { action: "submit" }), env, "r", deps);
    expect(response!.status).toBe(422);
    const body = await readJson(response!);
    expect(body.error?.code).toBe("INCOMPLETE_BRIEF");
  });

  it("publishes a clean brief and holds a suspicious one for moderation", async () => {
    const clean = world();
    const published = await handleListingRoute(jsonRequest("POST", "/api/v1/listings/L1/transition", { action: "submit" }), env, "r", clean.deps);
    expect((await readJson(published!)).message).toBe("Published");
    expect(clean.listing.status).toBe("published");

    const risky = world({ version: { outcome: "Pay a registration fee before you start work on the shop" } });
    const held = await handleListingRoute(jsonRequest("POST", "/api/v1/listings/L1/transition", { action: "submit" }), env, "r", risky.deps);
    expect((await readJson(held!)).message).toContain("moderator");
    expect(risky.listing.status).toBe("in_review");
  });

  it("lets only owners and admins change status, and rejects invalid transitions", async () => {
    const member = world({ membership: "member" });
    expect((await handleListingRoute(jsonRequest("POST", "/api/v1/listings/L1/transition", { action: "submit" }), env, "r", member.deps))!.status).toBe(403);
    const closed = world({ status: "closed" });
    const response = await handleListingRoute(jsonRequest("POST", "/api/v1/listings/L1/transition", { action: "resume" }), env, "r", closed.deps);
    expect(response!.status).toBe(409);
    expect((await readJson(response!)).error?.code).toBe("INVALID_TRANSITION");
  });

  it("detects concurrent edits with base_version", async () => {
    const { deps, fake } = world({ currentVersion: 3 });
    const response = await handleListingRoute(jsonRequest("PUT", "/api/v1/listings/L1", { ...COMPLETE, base_version: 2 }), env, "r", deps);
    expect(response!.status).toBe(409);
    expect((await readJson(response!)).error?.code).toBe("VERSION_CONFLICT");
    expect(fake.queries.some((q) => q.text.startsWith("INSERT INTO project_listing_versions"))).toBe(false);
  });

  it("saves an edit as a new version and re-screens published listings", async () => {
    const { deps, fake, listing } = world({ status: "published" });
    const response = await handleListingRoute(
      jsonRequest("PUT", "/api/v1/listings/L1", { ...COMPLETE, base_version: 1, outcome: "Contact me on telegram to discuss the shop website" }),
      env,
      "r",
      deps
    );
    expect(response!.status).toBe(200);
    const insert = fake.queries.find((q) => q.text.startsWith("INSERT INTO project_listing_versions"));
    expect(insert?.values[2]).toBe(2);
    expect(listing.status).toBe("in_review");
  });
});
