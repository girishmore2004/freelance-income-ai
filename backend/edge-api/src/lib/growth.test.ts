import { describe, expect, it } from "vitest";
import { profileChecklist, searchMatches, validateSearch } from "./growth-routes";

const listing = { title: "Bakery ordering website", outcome: "Customers order cakes online", description: "Next.js and Stripe", category_slug: "website_development", budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, skills: ["Next.js", "Stripe"] };
const filter = { query: "", category_slug: "", min_budget_minor: null as number | null, skills: [] as string[] };

describe("saved search matching", () => {
  it("needs every word, the category, enough budget and a shared skill", () => {
    expect(searchMatches({ ...filter, query: "bakery website" }, listing)).toBe(true);
    expect(searchMatches({ ...filter, query: "bakery app" }, listing)).toBe(false);
    expect(searchMatches({ ...filter, category_slug: "ui_ux_design" }, listing)).toBe(false);
    expect(searchMatches({ ...filter, min_budget_minor: 4_000_000 }, listing)).toBe(true);
    expect(searchMatches({ ...filter, min_budget_minor: 5_000_000 }, listing)).toBe(false);
    expect(searchMatches({ ...filter, min_budget_minor: 1 }, { ...listing, budget_min_minor: null, budget_max_minor: null })).toBe(false);
    expect(searchMatches({ ...filter, skills: ["nextjs", "Vue"] }, listing)).toBe(true);
    expect(searchMatches({ ...filter, skills: ["Vue"] }, listing)).toBe(false);
  });
});

describe("saved search validation", () => {
  it("needs a name and at least one filter", () => {
    expect(validateSearch({ name: "x", query: "a" })).toMatchObject({ ok: false });
    expect(validateSearch({ name: "Empty" })).toMatchObject({ ok: false, errors: { query: "Add at least one filter: words, a category, a budget or skills." } });
    expect(validateSearch({ name: "Budget", min_budget_minor: -5 })).toMatchObject({ ok: false });
    expect(validateSearch({ name: "Next.js sites", query: " next.js ", skills: ["Next.js", "Next.js", ""], alerts: false }))
      .toEqual({ ok: true, value: { name: "Next.js sites", query: "next.js", category_slug: "", min_budget_minor: null, skills: ["Next.js"], alerts: false } });
  });
});

describe("profile checklist", () => {
  it("scores what is done and lists the rest in order", () => {
    const empty = profileChecklist(undefined, { visible: false, verified: false, proposals: 0 });
    expect(empty.score).toBe(0);
    expect(empty.items[0].key).toBe("name");
    const full = profileChecklist(
      { full_name: "Ravi", skills: '["a","b","c"]', headline: "Next.js developer", portfolio_links: '["https://x.dev"]', hourly_rate: 1500, services: '["Sites"]', weekly_hours: 20, timezone: "Asia/Kolkata" },
      { visible: true, verified: true, proposals: 2 }
    );
    expect(full.score).toBe(100);
    const unsafeLink = profileChecklist({ portfolio_links: '["javascript:alert(1)"]' }, { visible: false, verified: false, proposals: 0 });
    expect(unsafeLink.items.find((i) => i.key === "portfolio")?.done).toBe(false);
    const viaProject = profileChecklist({ portfolio_items_json: '[{"title":"Shop","link":"https://shop.dev"}]' }, { visible: false, verified: false, proposals: 0 });
    expect(viaProject.items.find((i) => i.key === "portfolio")?.done).toBe(true);
    expect(viaProject.items.find((i) => i.key === "name")?.href).toBe("/profile");
  });
});
