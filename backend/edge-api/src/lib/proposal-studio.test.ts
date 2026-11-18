import { describe, expect, it } from "vitest";
import { canonicalContent, checkProposal, contentHash, describeChanges, linkKey, parseSections, rankEvidence, validateSections } from "./proposal-studio";
import type { CheckListing, StudioContent } from "./proposal-studio";

const TODAY = new Date("2026-11-18T09:00:00Z");
const LISTING: CheckListing = {
  budget_model: "fixed",
  budget_min_minor: 1_000_000,
  budget_max_minor: 2_500_000,
  deadline: "2026-12-18",
  skills: ["Next.js", "Stripe", "C++"],
  deliverables: ["Online order form", "Admin dashboard for orders"],
  revision_rounds: 2
};
const PROFILE = { skills: ["Next.js", "React"], portfolio_links: ["https://example.dev/work/bakery-site", "https://example.dev/work/blog"] };
const BASE = "I would build your ordering site in Next.js with a clean order form, tested end to end before launch.";

function content(over: Partial<StudioContent> = {}): StudioContent {
  return { cover_letter: BASE, price_minor: 2_000_000, estimated_days: 20, sections: null, ...over };
}

describe("validateSections", () => {
  it("accepts no sections (the short proposal form)", () => {
    expect(validateSections(undefined, [])).toEqual({ ok: true, value: null });
  });

  it("only accepts evidence links that are on the profile, ignoring trailing slashes and www", () => {
    const ok = validateSections({ evidence: [{ url: "https://www.example.dev/work/bakery-site/", note: "Bakery" }] }, PROFILE.portfolio_links);
    expect(ok.ok).toBe(true);
    const bad = validateSections({ evidence: [{ url: "https://example.dev/work/other" }] }, PROFILE.portfolio_links);
    expect(bad.ok).toBe(false);
    const script = validateSections({ evidence: [{ url: "javascript:alert(1)" }] }, ["javascript:alert(1)"]);
    expect(script.ok).toBe(false);
  });

  it("validates milestone amounts, list sizes, revision rounds and contact details", () => {
    const result = validateSections(
      { milestones: [{ title: "", amount_minor: 5 }], questions: Array.from({ length: 11 }, (_, i) => `q${i}`), revision_rounds: 11 },
      []
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["sections.milestones.0.amount_minor", "sections.milestones.0.title", "sections.questions", "sections.revision_rounds"]);
    }
    const leak = validateSections({ approach: "Message me on WhatsApp +91 98765 43210" }, []);
    expect(leak.ok).toBe(false);
  });
});

describe("checkProposal", () => {
  it("flags price above budget and timelines past the deadline", () => {
    const codes = checkProposal(content({ price_minor: 3_000_000, estimated_days: 45 }), LISTING, PROFILE, TODAY).map((f) => f.code);
    expect(codes).toContain("price_above_budget");
    expect(codes).toContain("timeline_after_deadline");
  });

  it("notes a price below the range without calling it wrong", () => {
    const f = checkProposal(content({ price_minor: 500_000 }), LISTING, PROFILE, TODAY).find((x) => x.code === "price_below_budget");
    expect(f?.severity).toBe("info");
  });

  it("flags milestone totals that differ from the price (fixed price only)", () => {
    const sections = validateSections({ milestones: [{ title: "A", amount_minor: 1_000_000 }, { title: "B", amount_minor: 900_000 }] }, []);
    if (!sections.ok) throw new Error("invalid");
    const fixed = checkProposal(content({ sections: sections.value }), LISTING, PROFILE, TODAY).map((f) => f.code);
    expect(fixed).toContain("milestones_total_mismatch");
    const hourly = checkProposal(content({ sections: sections.value }), { ...LISTING, budget_model: "hourly" }, PROFILE, TODAY).map((f) => f.code);
    expect(hourly).not.toContain("milestones_total_mismatch");
  });

  it("flags skills the profile does not list, experience claims, guarantees and unknown links", () => {
    const text = `${BASE} I have 10 years of experience with Stripe and C++, I guarantee results. See https://elsewhere.example/x and https://example.dev/work/blog`;
    const findings = checkProposal(content({ cover_letter: text }), LISTING, PROFILE, TODAY);
    const skills = findings.filter((f) => f.code === "unsupported_skill").map((f) => f.message);
    expect(skills.some((m) => m.includes('"Stripe"'))).toBe(true);
    expect(skills.some((m) => m.includes('"C++"'))).toBe(true);
    expect(skills.some((m) => m.includes('"Next.js"'))).toBe(false);
    expect(findings.some((f) => f.code === "unsupported_claim" && f.message.includes("10 years of experience"))).toBe(true);
    expect(findings.some((f) => f.code === "commitment")).toBe(true);
    const links = findings.filter((f) => f.code === "unknown_link");
    expect(links).toHaveLength(1);
    expect(links[0].message).toContain("elsewhere.example");
  });

  it("points out brief deliverables the proposal does not mention and missing assumptions", () => {
    const sections = validateSections({ deliverables: ["Online order form"] }, []);
    if (!sections.ok) throw new Error("invalid");
    const findings = checkProposal(content({ sections: sections.value }), LISTING, PROFILE, TODAY);
    const missing = findings.filter((f) => f.code === "deliverable_not_covered").map((f) => f.message);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Admin dashboard");
    expect(findings.map((f) => f.code)).toEqual(expect.arrayContaining(["missing_assumptions", "missing_exclusions", "no_evidence"]));
  });

  it("finds nothing to warn about in a consistent, evidenced proposal", () => {
    const sections = validateSections(
      {
        evidence: [{ url: PROFILE.portfolio_links[0], note: "Bakery ordering site" }],
        deliverables: ["Online order form", "Admin dashboard for orders"],
        milestones: [{ title: "Design", amount_minor: 800_000 }, { title: "Build", amount_minor: 1_200_000 }],
        assumptions: ["Menu content provided"],
        exclusions: ["Hosting fees"],
        revision_rounds: 2
      },
      PROFILE.portfolio_links
    );
    if (!sections.ok) throw new Error("invalid");
    expect(checkProposal(content({ sections: sections.value }), LISTING, PROFILE, TODAY)).toEqual([]);
  });
});

describe("hashing, evidence and history", () => {
  it("hashes the exact content: any change gives a new hash, same content the same hash", async () => {
    const a = await contentHash(content());
    expect(await contentHash(content())).toBe(a);
    expect(await contentHash(content({ price_minor: 2_000_100 }))).not.toBe(a);
    expect(canonicalContent(content())).toContain('"sections":null');
  });

  it("ranks portfolio links by brief keywords and only ever returns the profile's own links", () => {
    const ranked = rankEvidence(["https://example.dev/work/blog", "https://example.dev/work/bakery-ordering-site", "not a link"], { title: "Bakery ordering website", skills: ["Next.js"] });
    expect(ranked.map((r) => r.url)).toEqual(["https://example.dev/work/bakery-ordering-site", "https://example.dev/work/blog"]);
    expect(ranked[0].matched).toEqual(expect.arrayContaining(["bakery", "ordering"]));
  });

  it("describes what changed between versions", () => {
    const sections = parseSections(JSON.stringify({ approach: "New plan", deliverables: ["A"] }));
    expect(describeChanges(content(), content({ price_minor: 2_200_000, sections }))).toEqual(["Price ₹20,000 → ₹22,000", "Approach changed", "Deliverables changed"]);
    expect(parseSections("not json")).toBeNull();
    expect(linkKey("ftp://x.example/a")).toBeNull();
  });
});
