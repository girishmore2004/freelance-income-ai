import { describe, expect, it } from "vitest";
import { handleServiceRoute, orderTerms, screenService, validateService } from "./service-routes";
import { validateTerms } from "./contracts";
import type { Env } from "../types";
import type { Sql } from "./core-routes";
import type { AuthenticatedSession } from "./session-service";

const pkg = (key: string, price: number, days = 3) => ({ key, name: key[0].toUpperCase() + key.slice(1), description: "Logo files", price_minor: price, delivery_days: days, revisions: 2, deliverables: ["2 logo concepts", "PNG and SVG files"] });
const good = {
  category_slug: "graphic_design", title: "I will design a logo for your bakery", description: "Clean, modern logos for food businesses, with source files.",
  skills: ["Illustrator", "Illustrator", "Figma"], requirements: "Your business name and colours.", packages: [pkg("standard", 300000, 5), pkg("basic", 150000)]
};

describe("service validation", () => {
  it("accepts a complete service, sorts packages and removes duplicate skills", () => {
    const v = validateService(good);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.packages.map((p) => p.key)).toEqual(["basic", "standard"]);
    expect(v.value.skills).toEqual(["Illustrator", "Figma"]);
  });
  it("rejects bad packages, prices and titles", () => {
    expect(validateService({ ...good, title: "Logo" })).toMatchObject({ ok: false });
    expect(validateService({ ...good, packages: [] })).toMatchObject({ ok: false });
    expect(validateService({ ...good, packages: [pkg("basic", 1000)] })).toMatchObject({ ok: false });
    expect(validateService({ ...good, packages: [pkg("basic", 150000), pkg("basic", 200000)] })).toMatchObject({ ok: false });
    expect(validateService({ ...good, packages: [pkg("gold", 150000)] })).toMatchObject({ ok: false });
    expect(validateService({ ...good, packages: [pkg("basic", 150000, 0)] })).toMatchObject({ ok: false });
    expect(validateService({ ...good, packages: [pkg("basic", 300000), pkg("premium", 200000)] })).toMatchObject({ ok: false, errors: { packages: "Higher packages should not cost less than lower ones." } });
    expect(validateService({ ...good, packages: [{ ...pkg("basic", 150000), deliverables: [] }] })).toMatchObject({ ok: false });
  });
  it("screens contact and payment details", () => {
    const v = validateService({ ...good, description: "Clean logos. WhatsApp me on +91 98765 43210 and pay in bitcoin." });
    expect(v.ok).toBe(true);
    if (v.ok) expect(screenService(v.value)).toEqual(expect.arrayContaining(["off_platform_contact", "off_platform_payment"]));
    const clean = validateService(good);
    if (clean.ok) expect(screenService(clean.value)).toEqual([]);
  });
});

describe("order terms", () => {
  it("become valid one-milestone contract terms due after the delivery days", () => {
    const v = validateService(good);
    if (!v.ok) throw new Error("invalid");
    const today = new Date("2026-11-18T10:00:00Z");
    const terms = orderTerms({ title: v.value.title }, v.value.packages[1], "Bakery: Sweet Crumbs, colours brown and cream.", today);
    const valid = validateTerms(terms, "INR", today);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.value.total_minor).toBe(300000);
    expect(valid.value.milestones).toEqual([{ title: "Delivery: Standard", amount_minor: 300000, due_date: "2026-11-23" }]);
    expect(valid.value.revision_rounds).toBe(2);
    expect(valid.value.scope).toContain("Client's requirements:");
    expect(valid.value.title).toBe("I will design a logo for your bakery (Standard)");
    const leaked = validateTerms(orderTerms({ title: v.value.title }, v.value.packages[0], "mail me at a@b.co", today), "INR", today);
    expect(leaked.ok).toBe(false);
  });
});

const fake = (rows: (text: string) => unknown[]) => {
  const tag = (strings: TemplateStringsArray) => Promise.resolve(rows(strings.join("?")));
  Object.assign(tag, { end: async () => undefined });
  return tag as unknown as Sql;
};
const session = (id: string) => async () => ({ user: { id, email: "" } }) as unknown as AuthenticatedSession;

describe("service routes", () => {
  it("ignores other paths and hides category admin from non-staff", async () => {
    const sql = fake((t) => (/FROM user_roles/.test(t) ? [{ role: "freelancer" }] : []));
    const deps = { database: () => sql, authenticate: session("u1"), now: () => new Date() };
    expect(await handleServiceRoute(new Request("https://x/api/v1/servicesx"), {} as Env, "r", deps)).toBeNull();
    expect((await handleServiceRoute(new Request("https://x/api/v1/admin/categories"), {} as Env, "r", deps))?.status).toBe(404);
  });
  it("is closed while the client marketplace is off", async () => {
    const sql = fake(() => []);
    const deps = { database: () => sql, authenticate: async () => new Response("", { status: 401 }), now: () => new Date() };
    const res = await handleServiceRoute(new Request("https://x/api/v1/services"), { FEATURE_FLAGS_OFF: "marketplace.client_side" } as unknown as Env, "r", deps);
    expect(res?.status).toBe(403);
  });
});
