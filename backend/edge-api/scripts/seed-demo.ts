import worker from "../src/index";
import postgres from "postgres";

/*
 * Demo data for a separate test database (a Neon branch), never production (2026-11-20).
 *
 *   DEMO_DATABASE_URL=postgres://...  DEMO_PASSWORD='at least 12 characters'  npx tsx scripts/seed-demo.ts
 *
 * Everything is created through the real Edge Worker code (sign-up, profiles, projects,
 * proposals, contracts, test-mode payments, deliveries, reviews, services, disputes), so the
 * demo behaves exactly like real use. Staff roles are written the same way the founder's
 * staff-role workflow writes them. Every demo login ends with @demo.test.
 *
 * Safety: refuses to run when PRODUCTION_DATABASE_URL points at the same database host, and
 * when the database already holds demo accounts (delete the Neon branch and make a new one
 * to start again). Payments are test-mode only; real payments cannot be switched on.
 */

const url = (process.env.DEMO_DATABASE_URL ?? "").trim();
const password = process.env.DEMO_PASSWORD ?? "";
const production = (process.env.PRODUCTION_DATABASE_URL ?? "").trim();
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };

function stop(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}
if (!url) stop("DEMO_DATABASE_URL is not set.");
if (!hostOf(url)) stop("DEMO_DATABASE_URL is not a valid connection string.");
if (production && hostOf(production) === hostOf(url)) stop("DEMO_DATABASE_URL points at the PRODUCTION database. Use the connection string of the Neon 'demo' branch.");
if (password.length < 12) stop("DEMO_PASSWORD must be at least 12 characters.");

const env: Record<string, unknown> = {
  JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(), APP_ENV: "demo", PUBLIC_REGISTRATION: "true",
  REQUIRE_EMAIL_VERIFICATION: "false", CORS_ORIGINS: "https://seed.demo.test",
  HYPERDRIVE: { connectionString: url },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const db = postgres(url, { max: 2 });

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const problems: string[] = [];
type Res = { s: number; d: any; msg: string };

async function call(who: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const h: Record<string, string> = { "content-type": "application/json", origin: "https://seed.demo.test", ...headers };
  if (who && tokens[who]) h.authorization = `Bearer ${tokens[who]}`;
  const r = await (worker as any).fetch(new Request("https://api.demo.test" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { j = {}; }
  return { s: r.status, d: j.data ?? j, msg: String(j.message ?? j.error?.code ?? "") };
}
/** A step that must succeed; a failure is reported at the end and the seed continues. */
async function step(label: string, who: string | null, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Res> {
  const r = await call(who, method, path, body, headers);
  if (r.s >= 400) problems.push(`${label}: HTTP ${r.s} ${r.msg}`);
  else console.log(`ok  ${label}`);
  return r;
}

const mail = (k: string) => `${k}@demo.test`;
async function person(key: string, name: string, intent?: "freelancer" | "client" | "both"): Promise<void> {
  await step(`sign up ${mail(key)}`, null, "POST", "/api/v1/auth/register", { email: mail(key), password, full_name: name, ...(intent ? { intent } : {}) });
  const login = await call(null, "POST", "/api/v1/auth/login", { email: mail(key), password });
  if (!login.d?.access_token) stop(`Could not sign in as ${mail(key)} (HTTP ${login.s} ${login.msg}).`);
  tokens[key] = login.d.access_token;
  ids[key] = (await call(key, "GET", "/api/v1/me")).d.id;
}
async function orgOf(key: string): Promise<string> {
  const id = (await call(key, "GET", "/api/v1/me/identity")).d.organizations?.[0]?.id;
  if (!id) stop(`${mail(key)} has no client account.`);
  return id;
}
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let keyN = 0;
const idem = () => ({ "Idempotency-Key": `demo-${Date.now()}-${keyN++}` });

async function fund(client: string, contractId: string, index: number): Promise<void> {
  const f = await step(`fund milestone ${index + 1} (test mode)`, client, "POST", `/api/v1/contracts/${contractId}/milestones/${index}/fund`, {}, idem());
  if (f.d?.payment?.id) await step("complete test payment", client, "POST", `/api/v1/payments/sandbox/${f.d.payment.id}/complete`, { outcome: "succeed" });
}
async function hire(client: string, proposalId: string, freelancer: string, terms: Record<string, unknown>): Promise<string> {
  const o = await step("send offer", client, "POST", `/api/v1/listing-proposals/${proposalId}/offer`, { terms });
  const contractId = o.d?.id ?? o.d?.contract_id;
  await step("accept offer", freelancer, "POST", `/api/v1/contracts/${contractId}/accept`, { version: 1 });
  return contractId;
}
const brief = (title: string, outcome: string, skills: string[], min: number, max: number, extra: Record<string, unknown> = {}) => ({
  title, category_slug: "website_development", outcome, deliverables: ["Working pages", "Short handover note"], skills,
  acceptance_criteria: ["Works on mobile", "Owner can update the content"], budget_min_minor: min * 100, budget_max_minor: max * 100,
  deadline: day(90), visibility: "public", ...extra,
});

(async () => {
  const existing = await db`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@demo.test'`;
  if (existing[0].n > 0) {
    console.log(`This database already has ${existing[0].n} demo accounts. Nothing was changed. To start again, delete the Neon 'demo' branch and create a new one.`);
    await db.end();
    return;
  }

  // ---------- People ----------
  await person("admin", "Demo Admin");
  await person("moderator", "Demo Moderator");
  await person("finance", "Demo Finance");
  for (const [key, role] of [["admin", "admin"], ["moderator", "moderator"], ["finance", "finance"]] as const) {
    await db`INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at)
             VALUES (${crypto.randomUUID()}, ${ids[key]}, ${role}, 'active', 'demo-seed', now(), now()) ON CONFLICT DO NOTHING`;
    console.log(`ok  staff role ${role} for ${mail(key)}`);
  }
  await person("asha", "Asha Rao", "freelancer");
  await person("ravi", "Ravi Kumar", "freelancer");
  await person("neha", "Neha Iyer", "freelancer");
  await person("meera", "Meera Shah", "client");
  await person("arjun", "Arjun Mehta", "client");
  await person("kiran", "Kiran Patel", "both");

  // ---------- Platform switches for testing (this database only) ----------
  for (const flag of ["marketplace.client_side", "payments.sandbox", "payments.require_funding"]) {
    await step(`switch on ${flag}`, "admin", "POST", `/api/v1/admin/flags/${flag}`, { enabled: true });
  }
  const schedule = await step("fee schedule 5% + 3% (draft by finance)", "finance", "POST", "/api/v1/finance/fee-schedules", { name: "Demo fees", currency: "INR", client_fee_bps: 500, freelancer_fee_bps: 300, min_fee_minor: 0 });
  if (schedule.d?.id) await step("fee schedule approved by admin", "admin", "POST", `/api/v1/finance/fee-schedules/${schedule.d.id}/approve`, {});

  // ---------- Freelancer profiles ----------
  const profiles: Record<string, Record<string, unknown>> = {
    asha: { full_name: "Asha Rao", headline: "Next.js developer for small businesses", bio: "I build fast websites for local shops and cafes: ordering, bookings and SEO.", skills: ["Next.js", "React", "SEO", "Tailwind CSS"], services: ["Website development"], portfolio_links: ["https://example.com/asha/bakery"], hourly_rate: 1500, weekly_hours: 30, timezone: "Asia/Kolkata", preferred_work_types: ["fixed", "hourly"] },
    ravi: { full_name: "Ravi Kumar", headline: "WordPress and landing pages", bio: "Landing pages and menu sites that load quickly on phones.", skills: ["WordPress", "PHP", "SEO", "Landing pages"], services: ["Website development"], portfolio_links: ["https://example.com/ravi/menus"], hourly_rate: 900, weekly_hours: 25, timezone: "Asia/Kolkata", preferred_work_types: ["fixed"] },
    neha: { full_name: "Neha Iyer", headline: "Brand and social media designer", bio: "Logos, social templates and simple brand kits for small studios.", skills: ["Figma", "Logo design", "Canva", "Branding"], services: ["Design"], portfolio_links: ["https://example.com/neha/brands"], hourly_rate: 1200, weekly_hours: 20, timezone: "Asia/Kolkata", preferred_work_types: ["fixed", "hourly"] },
    kiran: { full_name: "Kiran Patel", headline: "Spreadsheets and small automations", bio: "Google Sheets dashboards and simple automations for small teams.", skills: ["Google Sheets", "Excel", "Automation"], services: ["Data and spreadsheets"], portfolio_links: ["https://example.com/kiran/sheets"], hourly_rate: 1000, weekly_hours: 15, timezone: "Asia/Kolkata", preferred_work_types: ["fixed", "hourly"] },
  };
  for (const [key, profile] of Object.entries(profiles)) {
    await step(`profile ${profile.full_name}`, key, "PUT", "/api/v1/profile", profile);
    await step(`show ${profile.full_name} to clients`, key, "PUT", "/api/v1/me/marketplace-profile", { visible: true });
  }
  await step("Asha portfolio project", "asha", "PUT", "/api/v1/me/portfolio-projects", { items: [{ title: "Bakery ordering site", description: "Online cake orders with pickup slots and an admin order list.", skills: ["Next.js", "SEO"], link: "https://example.com/asha/bakery", year: 2026 }] });

  // ---------- Client accounts ----------
  const acme = await orgOf("meera");
  await step("Meera's client account → Acme Bakery", "meera", "PATCH", `/api/v1/organizations/${acme}`, { name: "Acme Bakery", kind: "company", industry: "Food", website: "https://bakery.example.com", country: "IN", billing_name: "Acme Bakery LLP", billing_email: "accounts@bakery.example.com", billing_address: "Pune", tax_id: "" });
  const zen = await orgOf("arjun");
  await step("Arjun's client account → Zen Yoga Studio", "arjun", "PATCH", `/api/v1/organizations/${zen}`, { name: "Zen Yoga Studio", kind: "company", industry: "Fitness", website: "https://yoga.example.com", country: "IN", billing_name: "Zen Yoga Studio", billing_email: "accounts@yoga.example.com", billing_address: "Bengaluru", tax_id: "" });
  const kiranOrg = await orgOf("kiran");

  // ---------- Services (Fiverr-style) ----------
  const service = async (who: string, title: string, description: string, skills: string[], price: number, days: number) => {
    const s = await step(`service "${title}"`, who, "POST", "/api/v1/me/services", { category_slug: "website_development", title, description, skills, requirements: "Your logo, text and photos.", packages: [
      { key: "basic", name: "Basic", description: "The essentials", price_minor: price * 100, delivery_days: days, revisions: 1, deliverables: ["One deliverable"] },
      { key: "standard", name: "Standard", description: "More pages and one extra revision", price_minor: price * 180, delivery_days: days + 3, revisions: 2, deliverables: ["Three deliverables"] },
    ] });
    if (s.d?.id) await step(`publish "${title}"`, who, "POST", `/api/v1/services/${s.d.id}/transition`, { action: "publish" });
    return s.d?.id as string;
  };
  await service("asha", "Landing page for a small business", "A fast one-page website with a contact form, SEO basics and a mobile layout, built in Next.js.", ["Next.js", "SEO"], 8000, 5);
  await service("ravi", "Restaurant menu website", "A menu website with prices and photos that is easy to update and quick on phones.", ["WordPress", "SEO"], 6000, 4);
  const logo = await service("neha", "Logo and social media kit", "A simple logo with colours, fonts and five social media templates for a small studio.", ["Logo design", "Figma"], 5000, 4);

  // ---------- Meera (Acme Bakery): projects at every stage ----------
  const p1 = await step("project: Bakery ordering website", "meera", "POST", `/api/v1/organizations/${acme}/listings`, brief("Bakery ordering website", "Customers order cakes online and choose a pickup time.", ["Next.js", "SEO"], 20000, 40000));
  await step("publish: Bakery ordering website", "meera", "POST", `/api/v1/listings/${p1.d.id}/transition`, { action: "submit" });
  const pa = await step("Asha's proposal", "asha", "POST", `/api/v1/marketplace/listings/${p1.d.id}/proposals`, { cover_letter: "I built an ordering site for a bakery last year. I would start with the order form and pickup slots, then the admin order list, and test both on mobile with your staff before launch.", price_minor: 3000000, estimated_days: 21 });
  await step("Ravi's proposal", "ravi", "POST", `/api/v1/marketplace/listings/${p1.d.id}/proposals`, { cover_letter: "I can deliver the order form in two weeks with WordPress and WooCommerce, including an admin view and SEO basics for local search.", price_minor: 2500000, estimated_days: 14 });
  await step("Neha's proposal", "neha", "POST", `/api/v1/marketplace/listings/${p1.d.id}/proposals`, { cover_letter: "I would design the ordering screens first in Figma so you can see every step, then work with a developer you choose on the build.", price_minor: 2000000, estimated_days: 18 });
  await step("Meera messages Asha", "meera", "POST", `/api/v1/listing-proposals/${pa.d.id}/messages`, { body: "Can you also add a pickup time picker?" });
  await step("Asha replies", "asha", "POST", `/api/v1/listing-proposals/${pa.d.id}/messages`, { body: "Yes, the pickup time picker is part of the order form milestone." });
  await step("shortlist Asha", "meera", "POST", `/api/v1/listing-proposals/${pa.d.id}/status`, { action: "shortlist" });
  const k1 = await hire("meera", pa.d.id, "asha", { title: "Bakery ordering website", scope: "Order form with pickup times and an admin order list", deliverables: ["Order form", "Admin order list"],
    milestones: [{ title: "Order form", amount_minor: 1500000, due_date: day(14) }, { title: "Admin list and launch", amount_minor: 1500000, due_date: day(35) }],
    revision_rounds: 1, acceptance_criteria: ["Orders arrive in the admin list", "Works on mobile"], ownership_terms: "Client owns the code after final payment." });
  await fund("meera", k1, 0);
  await step("Asha delivers milestone 1 (waiting for Meera's review)", "asha", "POST", `/api/v1/contracts/${k1}/milestones/0/submit`, { note: "The order form with pickup times is ready; tested on Android and iPhone.", links: ["https://example.com/demo/bakery-order-form"] });
  await step("contract message", "meera", "POST", `/api/v1/contracts/${k1}/messages`, { body: "Thanks, I will review the order form today." });

  const p2 = await step("project: Menu page refresh", "meera", "POST", `/api/v1/organizations/${acme}/listings`, brief("Menu page refresh", "Our menu page shows current prices and photos and loads fast on phones.", ["WordPress", "SEO"], 8000, 15000));
  await step("publish: Menu page refresh", "meera", "POST", `/api/v1/listings/${p2.d.id}/transition`, { action: "submit" });
  const pr = await step("Ravi's proposal (menu)", "ravi", "POST", `/api/v1/marketplace/listings/${p2.d.id}/proposals`, { cover_letter: "I will update your menu page with prices and photos and make it fast on mobile within one week, then show you how to edit it.", price_minor: 1000000, estimated_days: 7 });
  const k2 = await hire("meera", pr.d.id, "ravi", { title: "Menu page refresh", scope: "Menu page with prices and photos", deliverables: ["Menu page"], milestones: [{ title: "Menu page", amount_minor: 1000000, due_date: day(10) }], revision_rounds: 1, acceptance_criteria: ["Works on mobile", "Owner can update the content"], ownership_terms: "Client owns the content." });
  await fund("meera", k2, 0);
  await step("Ravi delivers the menu page", "ravi", "POST", `/api/v1/contracts/${k2}/milestones/0/submit`, { note: "Menu page is live with prices and photos; editing guide included.", links: ["https://example.com/demo/menu"] });
  await step("Meera approves → paid, contract completed", "meera", "POST", `/api/v1/contracts/${k2}/milestones/0/review`, { decision: "approve", note: "" });
  await step("Meera reviews Ravi", "meera", "POST", `/api/v1/contracts/${k2}/review`, { rating: 5, comment: "Fast, careful and easy to work with." });
  await step("Ravi reviews Meera", "ravi", "POST", `/api/v1/contracts/${k2}/review`, { rating: 5, comment: "Clear brief and quick feedback." });

  const p3 = await step("project: Instagram post templates", "meera", "POST", `/api/v1/organizations/${acme}/listings`, { ...brief("Instagram post templates", "Ten post templates in our colours that staff can edit in Canva.", ["Canva", "Branding"], 5000, 10000), category_slug: "website_development" });
  await step("publish: Instagram post templates", "meera", "POST", `/api/v1/listings/${p3.d.id}/transition`, { action: "submit" });
  await step("Neha's proposal (templates)", "neha", "POST", `/api/v1/marketplace/listings/${p3.d.id}/proposals`, { cover_letter: "I will design ten editable Canva templates in your colours, with a short video showing your staff how to change text and photos.", price_minor: 800000, estimated_days: 6 });
  await step("draft project (not published)", "meera", "POST", `/api/v1/organizations/${acme}/listings`, brief("Loyalty card page", "Regular customers see their stamps online.", ["Next.js"], 15000, 25000));

  // ---------- Arjun (Zen Yoga Studio) ----------
  const p4 = await step("project: Class booking page", "arjun", "POST", `/api/v1/organizations/${zen}/listings`, brief("Class booking page", "Students book yoga classes online and get a reminder.", ["Next.js", "Booking"], 25000, 50000));
  await step("publish: Class booking page (open for proposals)", "arjun", "POST", `/api/v1/listings/${p4.d.id}/transition`, { action: "submit" });
  const held = await step("project with an upfront-fee request (held for review)", "arjun", "POST", `/api/v1/organizations/${zen}/listings`, brief("Quick data entry helpers", "Enter class bookings into our sheet. A refundable registration fee of ₹500 is required before you start.", ["Data entry"], 2000, 5000));
  if (held.d?.id) await step("submit the held project", "arjun", "POST", `/api/v1/listings/${held.d.id}/transition`, { action: "submit" });
  if (logo) {
    const order = await step("Arjun orders Neha's logo kit", "arjun", "POST", `/api/v1/services/${logo}/order`, { organization_id: zen, package: "basic", requirements: "Studio name Zen Yoga, calm greens, a lotus idea is welcome." });
    const k3 = order.d?.contract_id;
    if (k3) {
      await step("Neha accepts the order", "neha", "POST", `/api/v1/contracts/${k3}/accept`, { version: 1 });
      await fund("arjun", k3, 0);
      await step("Neha delivers (completes automatically in 3 days)", "neha", "POST", `/api/v1/contracts/${k3}/milestones/0/submit`, { note: "Logo in three colour versions plus five social templates.", links: ["https://example.com/demo/zen-logo"] });
    }
  }

  // ---------- A dispute for the staff queue ----------
  const p5 = await step("project: Studio flyer", "arjun", "POST", `/api/v1/organizations/${zen}/listings`, brief("Studio flyer and price list", "A printable flyer and price list for the studio front desk.", ["Design"], 3000, 6000));
  await step("publish: Studio flyer", "arjun", "POST", `/api/v1/listings/${p5.d.id}/transition`, { action: "submit" });
  const pk = await step("Kiran's proposal (flyer)", "kiran", "POST", `/api/v1/marketplace/listings/${p5.d.id}/proposals`, { cover_letter: "I will lay out a clean flyer and price list from your text, print-ready as PDF, with one round of changes included.", price_minor: 450000, estimated_days: 5 });
  const k4 = await hire("arjun", pk.d.id, "kiran", { title: "Studio flyer and price list", scope: "Flyer and price list", deliverables: ["Flyer PDF", "Price list PDF"], milestones: [{ title: "Flyer and price list", amount_minor: 450000, due_date: day(7) }], revision_rounds: 1, acceptance_criteria: ["Print-ready PDF"], ownership_terms: "Client owns the files." });
  await fund("arjun", k4, 0);
  await step("Kiran opens a dispute", "kiran", "POST", `/api/v1/contracts/${k4}/dispute`, { reason: "scope", description: "The client now wants a full brochure instead of the flyer and price list we agreed.", desired_outcome: "Keep the agreed flyer and price list scope." });

  // ---------- Kiran as a client too ----------
  const p6 = await step("Kiran's project: Bookkeeping spreadsheet", "kiran", "POST", `/api/v1/organizations/${kiranOrg}/listings`, brief("Bookkeeping spreadsheet", "A monthly income and expense sheet with a simple chart.", ["Google Sheets"], 4000, 8000));
  await step("publish: Bookkeeping spreadsheet", "kiran", "POST", `/api/v1/listings/${p6.d.id}/transition`, { action: "submit" });

  await db.end();
  console.log("\nDemo logins (all use the DEMO_PASSWORD you chose):");
  for (const [k, what] of [["admin", "Admin (staff)"], ["moderator", "Moderator (staff)"], ["finance", "Finance (staff)"], ["asha", "Freelancer"], ["ravi", "Freelancer"], ["neha", "Freelancer"], ["meera", "Client — Acme Bakery"], ["arjun", "Client — Zen Yoga Studio"], ["kiran", "Freelancer and client"]]) {
    console.log(`  ${mail(k).padEnd(22)} ${what}`);
  }
  if (problems.length) {
    console.log(`\n${problems.length} step(s) did not work:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nAll demo data created.");
})().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => undefined);
  process.exit(1);
});
