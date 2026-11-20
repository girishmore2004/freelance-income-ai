import worker from "../src/index";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { autoCompleteServiceDeliveries, expireCancellationRequests } from "../src/lib/deadlines";
import { decideSubmission } from "../src/lib/delivery-routes";
import { acceptCancellation } from "../src/lib/payment-routes";
import { releaseMilestone } from "../src/lib/payments";

/*
 * End-to-end test-case catalogue (2026-11-20). Run against a PostgreSQL database migrated to the
 * current head (never production):  npx tsx scripts/e2e-catalogue.ts /path/to/results.json
 * Connection: the HYPERDRIVE/db settings below (local socket /var/tmp, port 54329, database t_match). Every case runs through the real Edge Worker
 * (router, sessions, CSRF/CORS, handlers) on PostgreSQL with fresh accounts. No AI binding:
 * agents use their rule/template paths. Output: one row per case with the observed result.
 */
const env: any = {
  JWT_SECRET: "x".repeat(48), APP_ENV: "test", PUBLIC_REGISTRATION: "true", CORS_ORIGINS: "https://app.test",
  HYPERDRIVE: { connectionString: "postgres://postgres@127.0.0.1:54329/t_match" },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const db = postgres({ host: "/var/tmp", port: 54329, user: "postgres", database: "t_match" });

type Case = { id: string; area: string; title: string; expected: string; observed: string; ok: boolean };
const cases: Case[] = [];
const tokens: Record<string, string> = {};
type Res = { s: number; d: any; code: string; msg: string };

async function req(who: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const h: Record<string, string> = { "content-type": "application/json", origin: "https://app.test", ...headers };
  if (who && tokens[who]) h.authorization = `Bearer ${tokens[who]}`;
  const raw = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
  const r = await (worker as any).fetch(new Request("https://api.test" + path, { method, headers: h, body: raw }), env, ctx);
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 80) }; }
  return { s: r.status, d: j.data ?? j, code: j.error?.code ?? "", msg: String(j.message ?? "") };
}
function tc(id: string, area: string, title: string, expected: string, ok: boolean, observed: string) {
  cases.push({ id, area, title, expected, observed: observed.slice(0, 160), ok });
}
/** A case whose pass condition is the HTTP status (plus an optional extra check). */
async function st(id: string, area: string, title: string, who: string | null, method: string, path: string, body: unknown, want: number | number[], extra?: (r: Res) => [boolean, string], headers?: Record<string, string>): Promise<Res> {
  const r = await req(who, method, path, body, headers);
  const w = Array.isArray(want) ? want : [want];
  let ok = w.includes(r.s);
  let note = `${r.s}${r.code ? " " + r.code : ""}${r.msg ? " · " + r.msg : ""}`;
  if (ok && extra) { const [e, n] = extra(r); ok = e; note += ` · ${n}`; }
  tc(id, area, title, `${w.join("/")}${extra ? " + check" : ""}`, ok, note);
  return r;
}
const tag = Date.now().toString(36);
const mail = (k: string) => `${k}.${tag}@cases.test`;
const PW = "Correct-horse-42!";
const today = new Date().toISOString().slice(0, 10);

async function signup(who: string, intent?: string, name?: string): Promise<string> {
  await req(null, "POST", "/api/v1/auth/register", { email: mail(who), password: PW, full_name: name ?? who, ...(intent ? { intent } : {}) });
  const l = await req(null, "POST", "/api/v1/auth/login", { email: mail(who), password: PW });
  tokens[who] = l.d.access_token;
  return (await req(who, "GET", "/api/v1/me")).d.id;
}
const listing = (title: string, extra: Record<string, unknown> = {}) => ({
  title, category_slug: "website_development", outcome: "Customers order cakes online for pickup.", deliverables: ["Order form", "Admin order list"],
  skills: ["Next.js", "SEO"], acceptance_criteria: ["Orders arrive in the admin list", "Works on mobile"], budget_min_minor: 2000000, budget_max_minor: 4000000,
  deadline: "2027-06-30", visibility: "public", ...extra,
});
const letter = (n = 0) => `I built an ordering site for a bakery last year (case ${n}). I would start with your order form and pickup slots, then the admin order list, and test both on mobile with your staff before launch.`;
const terms2 = { title: "Bakery ordering website", scope: "Order form and admin list", deliverables: ["Order form", "Admin order list"], milestones: [{ title: "Order form", amount_minor: 1500000, due_date: "2027-01-15" }, { title: "Admin list and launch", amount_minor: 1500000, due_date: "2027-02-15" }], revision_rounds: 1, acceptance_criteria: ["Orders arrive in the admin list", "Works on mobile"], ownership_terms: "Client owns the code after final payment." };

(async () => {
  // ================= V: visitors, sign-up and sign-in =================
  const A = "Visitor and sign-up";
  await st("V01", A, "Public home loads with real counts", null, "GET", "/api/v1/public/home", undefined, 200);
  await st("V02", A, "Visitors browse published projects", null, "GET", "/api/v1/marketplace/listings", undefined, 200, (r) => [!JSON.stringify(r.d).includes("@cases.test"), "no email addresses in the reply"]);
  await st("V03", A, "Visitors browse the freelancer directory", null, "GET", "/api/v1/public/freelancers", undefined, 200);
  await st("V04", A, "Visitors browse services", null, "GET", "/api/v1/services", undefined, 200);
  await st("V05", A, "Pricing page data", null, "GET", "/api/v1/public/pricing", undefined, 200);
  await st("V06", A, "Contracts need sign-in", null, "GET", "/api/v1/contracts", undefined, 401);
  await st("V07", A, "Support ticket without an email is refused", null, "POST", "/api/v1/support/tickets", { topic: "payments", subject: "Fees question", body: "How are the fees charged on a project?" }, 422);
  await st("V08", A, "Support ticket with an email is accepted", null, "POST", "/api/v1/support/tickets", { topic: "payments", subject: "Fees question", body: "How are the fees charged on a project?", email: mail("visitor") }, 201);
  const sides = async (who: string) => ((await req(who, "GET", "/api/v1/me")).d.roles ?? []).filter((r: string) => r === "freelancer" || r === "client").sort().join("+");
  const F = await signup("asha", "freelancer", "Asha Rao");
  tc("V09", A, "Sign up with Find work → Freelancer side only", "freelancer", (await sides("asha")) === "freelancer", await sides("asha"));
  const C = await signup("acme", "client", "Meera Shah");
  tc("V10", A, "Sign up with Hire → Client side only", "client", (await sides("acme")) === "client", await sides("acme"));
  const B = await signup("both", "both", "Kiran Both");
  tc("V11", A, "Sign up with Both → both sides", "client+freelancer", (await sides("both")) === "client+freelancer", await sides("both"));
  await st("V12", A, "Unknown sign-up choice is refused", null, "POST", "/api/v1/auth/register", { email: mail("x1"), password: PW, intent: "boss" }, 422);
  await st("V13", A, "Password under 12 characters is refused", null, "POST", "/api/v1/auth/register", { email: mail("x2"), password: "short1!" }, 422);
  await st("V14", A, "Malformed email is refused", null, "POST", "/api/v1/auth/register", { email: "not-an-email", password: PW }, 422);
  await st("V15", A, "Registering an existing email does not reveal it exists", null, "POST", "/api/v1/auth/register", { email: mail("asha"), password: PW }, [200, 201], (r) => [!/already|exists|taken/i.test(r.msg + JSON.stringify(r.d)), "neutral wording"]);
  await st("V16", A, "Sign-in ignores email letter case", null, "POST", "/api/v1/auth/login", { email: mail("asha").toUpperCase(), password: PW }, 200);
  await st("V17", A, "Wrong password is refused", null, "POST", "/api/v1/auth/login", { email: mail("both"), password: "Wrong-horse-42!" }, 401);
  const lockWho = await signup("lock", "freelancer");
  for (let i = 0; i < 5; i += 1) await req(null, "POST", "/api/v1/auth/login", { email: mail("lock"), password: "Wrong-horse-42!" });
  await st("V18", A, "After 5 wrong passwords, the right password gets the lockout message (U29)", null, "POST", "/api/v1/auth/login", { email: mail("lock"), password: PW }, 423, (r) => [/try again in \d+ minute/i.test(r.msg), r.msg]);
  await st("V25", A, "During the lock a wrong password still gets the usual answer (no hint the account exists)", null, "POST", "/api/v1/auth/login", { email: mail("lock"), password: "Wrong-horse-42!" }, 401, (r) => [r.code === "INVALID_CREDENTIALS", r.code]);
  await st("V26", A, "A one-letter name at sign-up is refused", null, "POST", "/api/v1/auth/register", { email: mail("x3"), password: PW, full_name: "A", intent: "client" }, 422);
  void lockWho;
  await st("V19", A, "Unknown email gets the same answer as a wrong password", null, "POST", "/api/v1/auth/login", { email: mail("nobody"), password: PW }, 401);
  await st("V20", A, "A tampered session token is refused", null, "GET", "/api/v1/me", undefined, 401, undefined, { authorization: `Bearer ${String(tokens.asha).slice(0, -3)}abc` });
  await st("V21", A, "Password reset for an unknown email gives the same neutral answer", null, "POST", "/api/v1/auth/password-reset/request", { email: mail("nobody") }, [200, 202, 503], (r) => [!/not found|no account/i.test(r.msg), r.msg]);
  await signup("tmp", "freelancer");
  await req("tmp", "POST", "/api/v1/auth/logout", {});
  await st("V22", A, "After sign-out the old session no longer works", "tmp", "GET", "/api/v1/me", undefined, 401);
  await st("V23", A, "A browser preflight from an unknown site is refused (CORS)", null, "OPTIONS", "/api/v1/me", undefined, 403, undefined, { origin: "https://evil.test", "access-control-request-method": "POST" });
  await st("V24", A, "A browser preflight from the app is allowed", null, "OPTIONS", "/api/v1/me", undefined, [200, 204], undefined, { origin: "https://app.test", "access-control-request-method": "POST" });

  // ================= Staff setup (what the founder's workflow writes) =================
  const MO = await signup("mod"); const FI = await signup("fin"); const AD = await signup("admin");
  const AD2 = await signup("admin2");
  for (const [u, role] of [[MO, "moderator"], [FI, "finance"], [AD, "admin"], [AD2, "admin"]] as const) {
    await db`INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at) VALUES (${crypto.randomUUID()}, ${u}, ${role}, 'active', 'workflow', now(), now()) ON CONFLICT DO NOTHING`;
  }
  await req("admin", "POST", "/api/v1/admin/flags/payments.require_funding", { enabled: true });
  const fsch = await req("fin", "POST", "/api/v1/finance/fee-schedules", { name: `Launch ${tag}`, currency: "INR", client_fee_bps: 500, freelancer_fee_bps: 300, min_fee_minor: 0 });
  await req("admin", "POST", `/api/v1/finance/fee-schedules/${fsch.d.id}/approve`, {});

  // ================= F: freelancer journey =================
  const FA = "Freelancer";
  const R = await signup("ravi", "freelancer", "Ravi Kumar");
  const profile = { full_name: "Asha Rao", headline: "Next.js developer for small businesses", skills: ["Next.js", "SEO", "React"], services: ["Website development"], portfolio_links: ["https://example.dev/work/bakery"], hourly_rate: 1500, weekly_hours: 30, timezone: "Asia/Kolkata", preferred_work_types: ["fixed", "hourly"] };
  await st("F01", FA, "Save a complete profile", "asha", "PUT", "/api/v1/profile", profile, 200);
  await req("ravi", "PUT", "/api/v1/profile", { ...profile, full_name: "Ravi Kumar" });
  await st("F02", FA, "A negative hourly rate is refused", "asha", "PUT", "/api/v1/profile", { ...profile, hourly_rate: -5 }, 422);
  await st("F03", FA, "Show my profile to clients", "asha", "PUT", "/api/v1/me/marketplace-profile", { visible: true }, 200);
  await req("ravi", "PUT", "/api/v1/me/marketplace-profile", { visible: true });
  await st("F04", FA, "A portfolio project with a javascript: link is refused", "asha", "PUT", "/api/v1/me/portfolio-projects", { items: [{ title: "Bad link", description: "x", skills: [], link: "javascript:alert(1)", year: 2026 }] }, 422);
  await st("F05", FA, "Add a portfolio project", "asha", "PUT", "/api/v1/me/portfolio-projects", { items: [{ title: "Bakery ordering site", description: "Online ordering for a local bakery with pickup slots.", skills: ["Next.js"], link: "https://example.dev/work/bakery", year: 2026 }] }, 200);
  await st("F06", FA, "F3 reads a pasted resume and saves nothing by itself", "asha", "POST", "/api/v1/profile/resume-extract", { text: "Asha Rao. Next.js and React developer. Skills: Next.js, React, SEO. https://example.dev/work" }, 200, (r) => [r.d.saved === false || r.d.saved === undefined, `saved=${r.d.saved}`]);
  await st("F07", FA, "F3 profile review gives fixes", "asha", "GET", "/api/v1/me/profile-review", undefined, 200);
  await st("F08", FA, "Profile checklist", "asha", "GET", "/api/v1/me/profile-checklist", undefined, 200);
  await st("F09", FA, "F7 capacity (booked vs free hours)", "asha", "GET", "/api/v1/me/capacity", undefined, 200);
  await st("F10", FA, "Saved search for Find work", "asha", "POST", "/api/v1/me/saved-searches", { name: "Next.js work", query: "Next.js", alerts: true }, [200, 201]);
  await st("F11", FA, "Weekly proposal limit is shown with its reason", "asha", "GET", "/api/v1/me/proposal-quota", undefined, 200, (r) => [Number(r.d.limit) >= 10, `limit ${r.d.limit}, remaining ${r.d.remaining}`]);

  // Client creates the project the freelancers apply to
  const CA = "Client";
  const idC = await req("acme", "GET", "/api/v1/me/identity");
  const org = idC.d.organizations?.[0];
  tc("C01", CA, "A Hire sign-up gets a client account named after the person (U29)", "\"Meera Shah\", individual, owner", Boolean(org) && org.membership_role === "owner" && org.name === "Meera Shah", org ? `${org.name} · ${org.kind} · ${org.membership_role}` : "none");
  await st("C02", CA, "Edit the client profile to a company with billing details", "acme", "PATCH", `/api/v1/organizations/${org.id}`, { name: `Acme Bakery ${tag}`, kind: "company", industry: "Food", website: "https://bakery.example.com", country: "IN", billing_name: "Acme Bakery LLP", billing_email: "accounts@bakery.example.com", billing_address: "Pune", tax_id: "" }, 200);
  await st("C03", CA, "A website without https:// is refused", "acme", "PATCH", `/api/v1/organizations/${org.id}`, { name: `Acme Bakery ${tag}`, kind: "company", industry: "Food", website: "bakery.example.com", country: "IN" }, 422);
  await st("C04", CA, "C1 Brief Builder drafts a brief (not stored)", "acme", "POST", `/api/v1/organizations/${org.id}/brief-assistant`, { category_slug: "website_development", notes: "We are a bakery and want customers to order cakes online and pick them up." }, 200);
  await st("C05", CA, "A budget whose minimum is above its maximum is refused", "acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Bad budget", { budget_min_minor: 5000000, budget_max_minor: 1000000 }), 422);
  const L = await st("C06", CA, "Create a project draft", "acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Bakery ordering website"), 201);
  await st("C07", CA, "Publish the project (screened, live)", "acme", "POST", `/api/v1/listings/${L.d.id}/transition`, { action: "submit" }, 200, (r) => [r.d.status === "published", `status ${r.d.status}, moderation ${r.d.moderation_status}`]);
  const Lscam = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Quick job", { outcome: "Pay a registration fee of 500 on WhatsApp before starting, then build the site." }));
  await st("C08", CA, "A project asking for an upfront fee is held for review, not published", "acme", "POST", `/api/v1/listings/${Lscam.d.id}/transition`, { action: "submit" }, 200, (r) => [r.d.status !== "published" || r.d.moderation_status === "in_review", `status ${r.d.status}, moderation ${r.d.moderation_status}`]);
  await st("C09", CA, "Visitors see the published project", null, "GET", `/api/v1/marketplace/listings/${L.d.id}`, undefined, 200);
  await st("C10", CA, "Visitors cannot see the held project", null, "GET", `/api/v1/marketplace/listings/${Lscam.d.id}`, undefined, 404);
  const ver = (await req("acme", "GET", `/api/v1/listings/${L.d.id}`)).d;
  await st("C11", CA, "Editing a published project creates a new version", "acme", "PUT", `/api/v1/listings/${L.d.id}`, { ...listing("Bakery ordering website"), outcome: "Customers order cakes online for pickup, with time slots.", base_version: ver.version ?? ver.current_version ?? 1 }, 200);
  await st("C12", CA, "C2 matches explain every score", "acme", "GET", `/api/v1/listings/${L.d.id}/matches`, undefined, 200, (r) => { const m = r.d.matches ?? []; return [m.length > 0 && m.every((x: any) => (x.reasons ?? x.explanation ?? []).length > 0), `${m.length} matches`]; });
  await req("ravi", "PUT", "/api/v1/me/marketplace-profile", { visible: false });
  const mt = await req("acme", "GET", `/api/v1/listings/${L.d.id}/matches`);
  tc("C13", CA, "A freelancer who hid their profile is not suggested", "Ravi absent", !(mt.d.matches ?? []).some((m: any) => m.freelancer_user_id === R || m.user_id === R), `${(mt.d.matches ?? []).length} matches`);
  await req("ravi", "PUT", "/api/v1/me/marketplace-profile", { visible: true });
  await st("C14", CA, "Invite a freelancer", "acme", "POST", `/api/v1/listings/${L.d.id}/invitations`, { freelancer_user_id: F, message: "We liked your bakery project." }, 201);
  await st("C15", CA, "Inviting the same freelancer twice is refused", "acme", "POST", `/api/v1/listings/${L.d.id}/invitations`, { freelancer_user_id: F, message: "Again" }, 409);
  await st("C16", CA, "Save a freelancer for later", "acme", "POST", `/api/v1/organizations/${org.id}/saved-freelancers`, { freelancer_user_id: R, note: "Backup" }, [200, 201]);

  // Freelancer side of the hiring flow
  await st("F12", FA, "See invitations received", "asha", "GET", "/api/v1/me/invitations", undefined, 200, (r) => [(Array.isArray(r.d) ? r.d : r.d.items ?? []).length >= 1, "invitation listed"]);
  await st("F13", FA, "F2 Projects for you includes the project", "asha", "GET", "/api/v1/me/suggested-projects", undefined, 200);
  await st("F14", FA, "Save a project", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/save`, { saved: true, note: "" }, [200, 201]);
  await st("F15", FA, "F5 price advice with take-home after fees", "asha", "GET", `/api/v1/marketplace/listings/${L.d.id}/price-advice?hours=20`, undefined, 200);
  await st("F16", FA, "F4 proposal draft (template without AI provider)", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposal-draft`, { price_minor: 3000000 }, 200);
  await st("F17", FA, "Proposal check flags a phone number before sending", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposal-check`, { cover_letter: letter(1) + " Call me on 9876543210.", price_minor: 3000000, estimated_days: 21 }, [200, 422], (r) => [r.s === 422 ? r.code === "INVALID_PROPOSAL" : (r.d.findings ?? []).length > 0, r.s === 422 ? "field error on the letter" : "finding"]);
  await st("F18", FA, "A proposal with a phone number is refused", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposals`, { cover_letter: letter(2) + " WhatsApp 9876543210", price_minor: 3000000, estimated_days: 21 }, 422);
  await st("F19", FA, "A proposal with price 0 is refused", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposals`, { cover_letter: letter(3), price_minor: 0, estimated_days: 21 }, 422);
  const chk = await req("asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposal-check`, { cover_letter: letter(4), price_minor: 3000000, estimated_days: 21 });
  const P = await st("F20", FA, "Send the approved proposal", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposals`, { cover_letter: letter(4), price_minor: 3000000, estimated_days: 21, approved_hash: chk.d.content_hash }, 201);
  await st("F21", FA, "A second proposal on the same project is refused", "asha", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposals`, { cover_letter: letter(5), price_minor: 2800000, estimated_days: 20 }, 409);
  await st("F22", FA, "Edit the proposal while it is open (new version)", "asha", "PUT", `/api/v1/listing-proposals/${P.d.id}`, { cover_letter: letter(6), price_minor: 2900000, estimated_days: 20 }, 200);
  await st("F23", FA, "Proposal version history", "asha", "GET", `/api/v1/listing-proposals/${P.d.id}/versions`, undefined, 200);
  const P2 = await req("ravi", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposals`, { cover_letter: "I can deliver the order form in two weeks with Next.js, including an admin view and SEO basics for local search.", price_minor: 2500000, estimated_days: 14 });
  const Lnear = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Cafe ordering website"));
  await req("acme", "POST", `/api/v1/listings/${Lnear.d.id}/transition`, { action: "submit" });
  await st("F24", FA, "A near-copy of a proposal sent to another project is warned about (warning only)", "ravi", "POST", `/api/v1/marketplace/listings/${Lnear.d.id}/proposal-check`, { cover_letter: "I can deliver the order form in two weeks with Next.js, including an admin view and SEO basics for local search.", price_minor: 2500000, estimated_days: 14 }, 200, (r) => { const f = (r.d.findings ?? []).find((x: any) => x.code === "near_duplicate"); return [Boolean(f) && f.severity === "warn", f ? f.message : "no warning"]; });
  // Invite-only project
  const Linv = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Private logo job", { visibility: "invite_only" }));
  await req("acme", "POST", `/api/v1/listings/${Linv.d.id}/transition`, { action: "submit" });
  await st("F25", FA, "An invite-only project is hidden from freelancers not invited", "ravi", "GET", `/api/v1/marketplace/listings/${Linv.d.id}`, undefined, 404);
  await st("F26", FA, "…and a proposal to it is refused", "ravi", "POST", `/api/v1/marketplace/listings/${Linv.d.id}/proposals`, { cover_letter: letter(7), price_minor: 1000000, estimated_days: 7 }, [403, 404]);
  // Client and the person on both sides
  await st("F27", FA, "Someone with both sides can propose to another client's project", "both", "POST", `/api/v1/marketplace/listings/${L.d.id}/proposals`, { cover_letter: letter(8), price_minor: 1000000, estimated_days: 7 }, 201, (r) => [true, "different account owns the project, allowed"]);
  const idB = await req("both", "GET", "/api/v1/me/identity");
  const orgB = idB.d.organizations?.[0];
  const LB = await req("both", "POST", `/api/v1/organizations/${orgB?.id}/listings`, listing("Own project"));
  await req("both", "POST", `/api/v1/listings/${LB.d.id}/transition`, { action: "submit" });
  await st("F28", FA, "…but proposing to a project of their own client account is refused", "both", "POST", `/api/v1/marketplace/listings/${LB.d.id}/proposals`, { cover_letter: letter(9), price_minor: 1000000, estimated_days: 7 }, [403, 404, 409, 422]);

  // ================= Discussion, interview, comparison, offer =================
  await st("C17", CA, "Message the freelancer about the proposal", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/messages`, { body: "Can you also add a pickup time picker?" }, [200, 201]);
  await st("C18", CA, "A message with an email address is refused", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/messages`, { body: "Mail me at owner@bakery.example.com" }, 422);
  const iv = await st("C19", CA, "Propose an interview with a meeting link", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/interviews`, { starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), duration_minutes: 30, mode: "video", meeting_link: "https://meet.google.com/abc-defg-hij" }, [200, 201]);
  await st("C20", CA, "The proposer cannot accept their own interview time", "acme", "POST", `/api/v1/proposal-interviews/${iv.d.id}/respond`, { response: "accept" }, 403);
  await st("F29", FA, "The freelancer accepts the interview", "asha", "POST", `/api/v1/proposal-interviews/${iv.d.id}/respond`, { response: "accept" }, 200);
  await st("C21", CA, "A meeting link outside the allowed services is refused", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/interviews`, { starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), duration_minutes: 30, mode: "video", meeting_link: "https://evil.example/meet" }, 422);
  await st("C22", CA, "C3 compares proposals without ranking people", "acme", "GET", `/api/v1/listings/${L.d.id}/proposal-comparison`, undefined, 200, (r) => [!JSON.stringify(r.d).includes("\"rank\""), `${(r.d.rows ?? []).length} rows`]);
  await st("C23", CA, "C4 interview questions", "acme", "GET", `/api/v1/listing-proposals/${P.d.id}/interview-prep`, undefined, 200);
  await st("C24", CA, "Shortlist the proposal", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/status`, { action: "shortlist" }, 200);
  await st("C25", CA, "C5 suggests milestones that add up to the price", "acme", "GET", `/api/v1/listing-proposals/${P.d.id}/suggested-terms`, undefined, 200, (r) => { const ms = r.d.terms?.milestones ?? []; const sum = ms.reduce((a: number, m: any) => a + m.amount_minor, 0); return [ms.length > 0 && sum === 2900000, `${ms.length} milestones sum ${sum}`]; });
  await st("C26", CA, "An offer with a zero-amount milestone is refused", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/offer`, { terms: { ...terms2, milestones: [{ title: "Nothing", amount_minor: 0, due_date: "2027-01-15" }] } }, 422);
  const offer = await st("C27", CA, "Send the offer (2 milestones)", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/offer`, { terms: terms2 }, 201);
  const K = offer.d.id ?? offer.d.contract_id;
  await st("C28", CA, "A second offer on the same proposal is refused", "acme", "POST", `/api/v1/listing-proposals/${P.d.id}/offer`, { terms: terms2 }, 409);
  await st("F30", FA, "Accepting an old version of the offer is refused", "asha", "POST", `/api/v1/contracts/${K}/accept`, { version: 99 }, [409, 422]);
  await st("F31", FA, "Accept the offer → contract active", "asha", "POST", `/api/v1/contracts/${K}/accept`, { version: 1 }, 200, (r) => [r.d.status === "active" || r.d.contract?.status === "active", `status ${r.d.status ?? r.d.contract?.status}`]);
  await st("C29", CA, "Decline the other proposal", "acme", "POST", `/api/v1/listing-proposals/${P2.d.id}/status`, { action: "decline" }, 200);

  // ================= Money in test mode =================
  await st("F32", FA, "Delivery before the milestone is funded is refused", "asha", "POST", `/api/v1/contracts/${K}/milestones/0/submit`, { note: "Form ready", links: ["https://example.dev/demo"] }, 409);
  await st("F33", FA, "The freelancer cannot fund a milestone", "asha", "POST", `/api/v1/contracts/${K}/milestones/0/fund`, {}, 403, undefined, { "Idempotency-Key": `x-${tag}` });
  const fund0 = await st("C30", CA, "Fund milestone 1: client pays price + 5% fee", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/fund`, {}, [200, 201], (r) => [r.d.payment?.total_minor === 1575000, `total ${r.d.payment?.total_minor}`], { "Idempotency-Key": `fund-${tag}-0` });
  await st("C31", CA, "Repeating the same funding request returns the same checkout", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/fund`, {}, [200, 201], (r) => [r.d.payment?.id === fund0.d.payment?.id, "same payment id"], { "Idempotency-Key": `fund-${tag}-0` });
  await st("C32", CA, "Complete the test payment", "acme", "POST", `/api/v1/payments/sandbox/${fund0.d.payment?.id}/complete`, { outcome: "succeed" }, 200);
  await st("C33", CA, "Funding the same milestone again is refused", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/fund`, {}, 409, undefined, { "Idempotency-Key": `fund-${tag}-again` });
  await st("C34", CA, "C6 acceptance check before any delivery is refused", "acme", "GET", `/api/v1/contracts/${K}/milestones/0/acceptance-check`, undefined, 409);
  await st("F34", FA, "F8 checks the delivery against the criteria (no change)", "asha", "POST", `/api/v1/contracts/${K}/milestones/0/precheck`, { note: "Orders arrive in the admin list and it works on mobile.", links: ["https://example.dev/demo"] }, 200);
  await st("F35", FA, "A delivery link without https is refused", "asha", "POST", `/api/v1/contracts/${K}/milestones/0/submit`, { note: "Order form is ready for review", links: ["http://example.dev/demo"] }, 422, (r) => [/https/i.test(JSON.stringify(r.d)), `field error: ${JSON.stringify(r.d.error?.details ?? []).slice(0, 80)}`]);
  await st("F36", FA, "Deliver milestone 1", "asha", "POST", `/api/v1/contracts/${K}/milestones/0/submit`, { note: "Orders arrive in the admin list; tested on mobile.", links: ["https://example.dev/demo"] }, [200, 201]);
  await st("F37", FA, "A second delivery while one is waiting is refused", "asha", "POST", `/api/v1/contracts/${K}/milestones/0/submit`, { note: "Delivering the same milestone again", links: ["https://example.dev/demo"] }, 409);
  await st("C35", CA, "C6 checks the delivery against the criteria", "acme", "GET", `/api/v1/contracts/${K}/milestones/0/acceptance-check`, undefined, 200);
  await st("C36", CA, "A revision request without a note is refused", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/review`, { decision: "request_revision", note: "" }, 422);
  await st("C37", CA, "Request a revision", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/review`, { decision: "request_revision", note: "Please add the pickup time picker." }, 200);
  await req("asha", "POST", `/api/v1/contracts/${K}/milestones/0/submit`, { note: "Pickup time picker added.", links: ["https://example.dev/demo2"] });
  await st("C38", CA, "A second revision beyond the 1 agreed round is refused", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/review`, { decision: "request_revision", note: "One more change." }, 409);
  await st("C39", CA, "Approve milestone 1 → payment released to the freelancer", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/review`, { decision: "approve", note: "" }, 200, (r) => [Boolean(r.d.payment), `payment ${r.d.payment}`]);
  await st("C40", CA, "Approving again is refused", "acme", "POST", `/api/v1/contracts/${K}/milestones/0/review`, { decision: "approve", note: "" }, 409);
  const earn1 = await st("F38", FA, "Earnings show ₹14,550 available (₹15,000 − 3%)", "asha", "GET", "/api/v1/me/earnings", undefined, 200, (r) => { const a = r.d.available_minor ?? r.d.balances?.[0]?.available_minor; return [a === 1455000, `available ${a}`]; });
  const avail = earn1.d.available_minor ?? earn1.d.balances?.[0]?.available_minor ?? 0;
  await st("F39", FA, "A payout above the balance is refused", "asha", "POST", "/api/v1/me/payouts", { amount_minor: avail + 100, idempotency_key: `po-big-${tag}` }, [409, 422]);
  const po = await st("F40", FA, "Withdraw the balance (test payout)", "asha", "POST", "/api/v1/me/payouts", { amount_minor: avail, idempotency_key: `po-${tag}` }, [200, 201]);
  await st("F41", FA, "Repeating the payout request returns the same payout", "asha", "POST", "/api/v1/me/payouts", { amount_minor: avail, idempotency_key: `po-${tag}` }, [200, 201], (r) => [r.d.id === po.d.id || r.d.payout?.id === po.d.payout?.id, "same payout"]);
  // Cancellation by agreement on milestone 2
  const fund1 = await req("acme", "POST", `/api/v1/contracts/${K}/milestones/1/fund`, {}, { "Idempotency-Key": `fund-${tag}-1` });
  await req("acme", "POST", `/api/v1/payments/sandbox/${fund1.d.payment?.id}/complete`, { outcome: "succeed" });
  await st("C41", CA, "Ask to cancel the rest of the contract", "acme", "POST", `/api/v1/contracts/${K}/cancellation`, { reason: "Our plans changed; we will launch later." }, [200, 201]);
  await st("C42", CA, "The requester cannot accept their own cancellation", "acme", "POST", `/api/v1/contracts/${K}/cancellation/respond`, { accept: true }, 403);
  await st("F42", FA, "The freelancer accepts → funded milestone 2 refunded, contract cancelled", "asha", "POST", `/api/v1/contracts/${K}/cancellation/respond`, { accept: true }, 200);
  await st("C43", CA, "Contract payments show milestone 2 refunded", "acme", "GET", `/api/v1/contracts/${K}/payments`, undefined, 200, (r) => [JSON.stringify(r.d).includes("refund"), "refund listed"]);
  // Reviews
  await st("C44", CA, "Reviews open only on completed contracts (this one was cancelled)", "acme", "POST", `/api/v1/contracts/${K}/review`, { rating: 5, comment: "Clear and on time." }, 409);
  // Statements
  await st("F43", FA, "Monthly statement", "asha", "GET", `/api/v1/me/statements?month=${today.slice(0, 7)}`, undefined, 200);
  await st("F44", FA, "A statement for a future month is refused", "asha", "GET", "/api/v1/me/statements?month=2031-01", undefined, 422);
  await st("C46", CA, "Client statement for the client account", "acme", "GET", `/api/v1/me/statements?month=${today.slice(0, 7)}&organization_id=${org.id}`, undefined, 200);
  await st("C47", CA, "Client analytics", "acme", "GET", `/api/v1/analytics/client?organization_id=${org.id}`, undefined, 200);
  await st("C48", CA, "C7 spend forecast", "acme", "GET", `/api/v1/analytics/client/forecast?organization_id=${org.id}`, undefined, 200);

  // ================= Full completion with reviews (second contract) =================
  const L3 = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Menu page update"));
  await req("acme", "POST", `/api/v1/listings/${L3.d.id}/transition`, { action: "submit" });
  const P3 = await req("ravi", "POST", `/api/v1/marketplace/listings/${L3.d.id}/proposals`, { cover_letter: "I will update your menu page with prices and photos, and make it fast on mobile within one week.", price_minor: 1000000, estimated_days: 7 });
  const o3 = await req("acme", "POST", `/api/v1/listing-proposals/${P3.d.id}/offer`, { terms: { ...terms2, title: "Menu page", milestones: [{ title: "Menu page", amount_minor: 1000000, due_date: "2027-01-10" }] } });
  const K3 = o3.d.id ?? o3.d.contract_id;
  await req("ravi", "POST", `/api/v1/contracts/${K3}/accept`, { version: 1 });
  const f3 = await req("acme", "POST", `/api/v1/contracts/${K3}/milestones/0/fund`, {}, { "Idempotency-Key": `f3-${tag}` });
  await req("acme", "POST", `/api/v1/payments/sandbox/${f3.d.payment?.id}/complete`, { outcome: "succeed" });
  await req("ravi", "POST", `/api/v1/contracts/${K3}/milestones/0/submit`, { note: "Menu live.", links: ["https://example.dev/menu"] });
  await st("C49", CA, "Approving the last milestone completes the contract", "acme", "POST", `/api/v1/contracts/${K3}/milestones/0/review`, { decision: "approve", note: "" }, 200, (r) => [r.d.contract_completed === true, `completed ${r.d.contract_completed}`]);
  await st("C45", CA, "A rating of 6 is refused", "acme", "POST", `/api/v1/contracts/${K3}/review`, { rating: 6, comment: "Too high" }, 422);
  await st("C50", CA, "Client review is saved", "acme", "POST", `/api/v1/contracts/${K3}/review`, { rating: 5, comment: "Fast and careful." }, [200, 201]);
  const rv = await req("ravi", "GET", `/api/v1/contracts/${K3}/reviews`);
  tc("C51", CA, "The client's review stays hidden until the freelancer reviews", "hidden", !JSON.stringify(rv.d).includes("Fast and careful"), JSON.stringify(rv.d).includes("Fast and careful") ? "visible early" : "hidden");
  await st("C52", CA, "Reviewing twice is refused", "acme", "POST", `/api/v1/contracts/${K3}/review`, { rating: 4, comment: "Again" }, 409);
  await st("F45", FA, "Freelancer review reveals both", "ravi", "POST", `/api/v1/contracts/${K3}/review`, { rating: 5, comment: "Clear brief." }, [200, 201]);
  const rv2 = await req("ravi", "GET", `/api/v1/contracts/${K3}/reviews`);
  tc("F46", FA, "After both reviews each side sees the other's", "visible", JSON.stringify(rv2.d).includes("Fast and careful"), JSON.stringify(rv2.d).includes("Fast and careful") ? "visible" : "hidden");
  await st("F47", FA, "A completed contract takes no new messages", "ravi", "POST", `/api/v1/contracts/${K3}/messages`, { body: "Thanks!" }, 409);

  // ================= Services (Fiverr-style) =================
  const svcBody = { category_slug: "website_development", title: "Landing page for a small business", description: "A fast one-page website with contact form, SEO basics and mobile layout, delivered in Next.js.", skills: ["Next.js", "SEO"], requirements: "Your logo, text and photos.", packages: [{ key: "basic", name: "Basic", description: "One page", price_minor: 800000, delivery_days: 5, revisions: 1, deliverables: ["One page"] }] };
  await st("F48", FA, "A service without packages is refused", "ravi", "POST", "/api/v1/me/services", { ...svcBody, packages: [] }, 422);
  await st("F49", FA, "A client-only account cannot sell services", "acme", "POST", "/api/v1/me/services", svcBody, 403);
  const svc = await st("F50", FA, "Create a service", "ravi", "POST", "/api/v1/me/services", svcBody, 201);
  await st("F51", FA, "Publish the service", "ravi", "POST", `/api/v1/services/${svc.d.id}/transition`, { action: "publish" }, 200, (r) => [r.d.status === "published", `status ${r.d.status}`]);
  const svcBad = await req("ravi", "POST", "/api/v1/me/services", { ...svcBody, title: "Cheap website", description: "Pay me directly on WhatsApp 9876543210 and I will start the website today, no platform needed." });
  await st("F52", FA, "A service with off-platform payment wording is held for review", "ravi", "POST", `/api/v1/services/${svcBad.d.id}/transition`, { action: "publish" }, [200, 422], (r) => [r.s === 422 || r.d.status !== "published", `status ${r.d.status ?? r.code}`]);
  await st("C53", CA, "Order a service with an unknown package is refused", "acme", "POST", `/api/v1/services/${svc.d.id}/order`, { organization_id: org.id, package: "gold", requirements: "Logo attached." }, 422);
  await st("C54", CA, "Order a service without requirements is refused", "acme", "POST", `/api/v1/services/${svc.d.id}/order`, { organization_id: org.id, package: "basic", requirements: "" }, 422);
  const order = await st("C55", CA, "Order the service → an offered contract the freelancer accepts", "acme", "POST", `/api/v1/services/${svc.d.id}/order`, { organization_id: org.id, package: "basic", requirements: "Logo and text attached in messages." }, 201);
  await st("F53", FA, "Accept the service order", "ravi", "POST", `/api/v1/contracts/${order.d.contract_id}/accept`, { version: 1 }, 200);
  await req("both", "PUT", "/api/v1/profile", { ...profile, full_name: "Kiran Both" });
  await req("both", "PUT", "/api/v1/me/marketplace-profile", { visible: true });
  const svcB = await req("both", "POST", "/api/v1/me/services", { ...svcBody, title: "Logo design for a shop" });
  await req("both", "POST", `/api/v1/services/${svcB.d.id}/transition`, { action: "publish" });
  await st("F54", FA, "Someone with both sides cannot order their own service", "both", "POST", `/api/v1/services/${svcB.d.id}/order`, { organization_id: orgB?.id, package: "basic", requirements: "Our logo files and colours are attached in messages." }, 409);

  // ================= Hourly contracts =================
  const LH = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Ongoing website support"));
  await req("acme", "POST", `/api/v1/listings/${LH.d.id}/transition`, { action: "submit" });
  const PH = await req("ravi", "POST", `/api/v1/marketplace/listings/${LH.d.id}/proposals`, { cover_letter: "I can support your website a few hours each week: fixes, updates and small features as you need them.", price_minor: 1500000, estimated_days: 30 });
  const ho = await st("C56", CA, "Hourly offer ₹1,200/h, 5 h a week", "acme", "POST", `/api/v1/listing-proposals/${PH.d.id}/offer`, { terms: { title: "Website support", scope: "Weekly support", deliverables: ["Fixes and updates"], milestones: [], billing: { type: "hourly", hourly_rate_minor: 120000, weekly_limit_hours: 5 }, revision_rounds: 0, acceptance_criteria: ["Agreed fixes are live"], ownership_terms: "" } }, 201);
  const KH = ho.d.id ?? ho.d.contract_id;
  await st("F55", FA, "Logging time before the contract is active is refused", "ravi", "POST", `/api/v1/contracts/${KH}/time-entries`, { work_date: today, minutes: 60, description: "Early work" }, 409);
  await req("ravi", "POST", `/api/v1/contracts/${KH}/accept`, { version: 1 });
  await st("F56", FA, "Log 2 h 30 min", "ravi", "POST", `/api/v1/contracts/${KH}/time-entries`, { work_date: today, minutes: 150, description: "Fixed the checkout bug" }, [200, 201]);
  await st("F57", FA, "Logging past the 5-hour weekly limit is refused", "ravi", "POST", `/api/v1/contracts/${KH}/time-entries`, { work_date: today, minutes: 200, description: "Too much" }, 409);
  await st("C57", CA, "The client cannot log time", "acme", "POST", `/api/v1/contracts/${KH}/time-entries`, { work_date: today, minutes: 30, description: "x" }, 403);
  const ts = await req("ravi", "GET", `/api/v1/contracts/${KH}/timesheets`);
  const week = ts.d.weeks?.[0];
  await st("C58", CA, "Paying a week before it is approved is refused", "acme", "POST", `/api/v1/timesheets/${week?.id}/pay`, {}, 409, undefined, { "Idempotency-Key": `w0-${tag}` });
  await st("F58", FA, "Submit the week", "ravi", "POST", `/api/v1/timesheets/${week?.id}/submit`, {}, 200);
  await st("F59", FA, "Logging into a submitted week is refused", "ravi", "POST", `/api/v1/contracts/${KH}/time-entries`, { work_date: today, minutes: 30, description: "Late" }, 409);
  await st("C59", CA, "Returning a week without a note is refused", "acme", "POST", `/api/v1/timesheets/${week?.id}/review`, { decision: "return", note: "" }, 422);
  await st("C60", CA, "Approve the week", "acme", "POST", `/api/v1/timesheets/${week?.id}/review`, { decision: "approve" }, 200);
  const tp = await st("C61", CA, "Pay the week: 2.5 h × ₹1,200 = ₹3,000 + 5% = ₹3,150", "acme", "POST", `/api/v1/timesheets/${week?.id}/pay`, {}, [200, 201], (r) => [r.d.payment?.total_minor === 315000, `total ${r.d.payment?.total_minor}`], { "Idempotency-Key": `w1-${tag}` });
  await req("acme", "POST", `/api/v1/payments/sandbox/${tp.d.payment?.id}/complete`, { outcome: "succeed" });
  await st("C62", CA, "Paying the same week again is refused", "acme", "POST", `/api/v1/timesheets/${week?.id}/pay`, {}, 409, undefined, { "Idempotency-Key": `w2-${tag}` });
  await st("C63", CA, "End the hourly contract", "acme", "POST", `/api/v1/contracts/${KH}/end`, {}, 200);
  await st("F60", FA, "Logging after the contract ended is refused", "ravi", "POST", `/api/v1/contracts/${KH}/time-entries`, { work_date: today, minutes: 30, description: "After end" }, 409);

  // ================= Fair proposals: weekly limit, caps =================
  const Q = await signup("quota", "freelancer", "Quota Tester");
  await req("quota", "PUT", "/api/v1/profile", { ...profile, full_name: "Quota Tester" });
  const many: string[] = [];
  for (let i = 0; i < 11; i += 1) {
    const l = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing(`Quota project ${i}`));
    await req("acme", "POST", `/api/v1/listings/${l.d.id}/transition`, { action: "submit" });
    many.push(l.d.id);
  }
  let sent = 0;
  for (let i = 0; i < 10; i += 1) {
    const r = await req("quota", "POST", `/api/v1/marketplace/listings/${many[i]}/proposals`, { cover_letter: `Proposal number ${i} for your project: I will plan the work, build it in Next.js and test it on mobile before handing it over to you. Reference ${i * 7919}.`, price_minor: 1000000 + i * 1000, estimated_days: 10 });
    if (r.s === 201) sent += 1;
  }
  tc("F61", FA, "A new freelancer can send 10 proposals in 7 days", "10 sent", sent === 10, `${sent} sent`);
  await st("F62", FA, "The 11th proposal in 7 days is refused with the reason", "quota", "POST", `/api/v1/marketplace/listings/${many[10]}/proposals`, { cover_letter: "One more proposal for this project with a clear plan, mobile testing and a handover call at the end of the work.", price_minor: 1000000, estimated_days: 10 }, 429);
  await st("C64", CA, "A cap below the proposals already received is refused", "acme", "POST", `/api/v1/listings/${many[0]}/intake`, { max_proposals: 0, accepting: true }, 422);
  await st("C65", CA, "Stop taking proposals on a project", "acme", "POST", `/api/v1/listings/${many[10]}/intake`, { max_proposals: null, accepting: false }, 200);
  await st("F63", FA, "A proposal to a project that stopped taking them is refused", "ravi", "POST", `/api/v1/marketplace/listings/${many[10]}/proposals`, { cover_letter: letter(11), price_minor: 1000000, estimated_days: 10 }, 409);
  await st("C66", CA, "Proposals received are shown as a range to freelancers", null, "GET", `/api/v1/marketplace/listings/${many[0]}`, undefined, 200, (r) => [typeof r.d.proposals === "string" && typeof r.d.accepting_proposals === "boolean", `range "${r.d.proposals}", accepting ${r.d.accepting_proposals}`]);

  // ================= Team (client account members) =================
  const MB = await signup("member", "freelancer", "Team Member");
  const inv = await st("C67", CA, "Invite a team member", "acme", "POST", `/api/v1/organizations/${org.id}/invitations`, { email: mail("member"), role: "member" }, 201);
  const tok = decodeURIComponent(String(inv.d.join_path ?? "").split("token=")[1] ?? "");
  await st("C68", CA, "Someone with a different email cannot use the invitation", "ravi", "POST", "/api/v1/organization-invitations/accept", { token: tok }, 403);
  await st("C69", CA, "The invited person joins (gets the client side)", "member", "POST", "/api/v1/organization-invitations/accept", { token: tok }, 200);
  await st("C70", CA, "A team member cannot publish projects", "member", "POST", `/api/v1/listings/${L3.d.id}/transition`, { action: "close" }, 403);
  await st("C71", CA, "A team member reads the client account's inbox", "member", "GET", "/api/v1/inbox", undefined, 200);
  await st("C72", CA, "A team member cannot fund milestones", "member", "POST", `/api/v1/contracts/${K3}/milestones/0/fund`, {}, [403, 409], undefined, { "Idempotency-Key": `m-${tag}` });
  const mem = await req("acme", "GET", `/api/v1/organizations/${org.id}/members`);
  const memRow = (mem.d.items ?? mem.d ?? []).find?.((m: any) => m.user_id === MB);
  await st("C73", CA, "Remove the team member", "acme", "POST", `/api/v1/organizations/${org.id}/members/${memRow?.user_id ?? MB}/remove`, {}, 200);
  await st("C74", CA, "A removed member loses access to the client account", "member", "GET", `/api/v1/organizations/${org.id}`, undefined, 404);

  // ================= Portal separation (API side) =================
  const PA = "Portals and sides";
  await req("acme", "POST", `/api/v1/listings/${many[5]}/invitations`, { freelancer_user_id: F, message: "Would you look at this project?" });
  const acts: any[] = [];
  for (const who of ["asha", "ravi", "acme", "both", "quota"]) { const pl = await req(who, "GET", "/api/v1/agent/action-plan"); acts.push(...(pl.d.actions ?? [])); }
  tc("P01", PA, "Every next action carries its side (5 accounts)", "side on each, at least 1 action", acts.length > 0 && acts.every((a: any) => a.side === "freelancer" || a.side === "client" || a.side === null), `${acts.length} actions: ${acts.filter((a) => a.side === "freelancer").length} freelancer, ${acts.filter((a) => a.side === "client").length} client`);
  const ov = await req("acme", "GET", "/api/v1/workspace/overview");
  tc("P02", PA, "Dashboard alerts and recommendations carry their side", "side on each", [...(ov.d.alerts ?? []), ...(ov.d.recommendations ?? [])].length > 0 && [...(ov.d.alerts ?? []), ...(ov.d.recommendations ?? [])].every((a: any) => "side" in a), `${(ov.d.alerts ?? []).length} alerts, ${(ov.d.recommendations ?? []).length} recommendations`);
  await st("P03", PA, "Unread notifications are split by side", "asha", "GET", "/api/v1/notifications/unread-count", undefined, 200, (r) => [typeof r.d.by_side === "object", JSON.stringify(r.d.by_side)]);
  await st("P04", PA, "A freelancer-only account cannot create a client account", "asha", "POST", "/api/v1/organizations", { name: "Asha Studio", kind: "individual", country: "IN" }, 403);
  await st("P05", PA, "A client-only account cannot send proposals", "acme", "POST", `/api/v1/marketplace/listings/${many[1]}/proposals`, { cover_letter: letter(12), price_minor: 1000000, estimated_days: 7 }, 403);
  const idF = await req("asha", "GET", "/api/v1/me/identity");
  tc("P06", PA, "A freelancer-only account has no client account", "0", (idF.d.organizations ?? []).length === 0, String((idF.d.organizations ?? []).length));
  await st("P07", PA, "Adding the Client side creates the client account", "asha", "POST", "/api/v1/me/roles", { role: "client" }, 200);
  const idF2 = await req("asha", "GET", "/api/v1/me/identity");
  tc("P08", PA, "…and it is there right away", "1", (idF2.d.organizations ?? []).length === 1, (idF2.d.organizations ?? []).map((o: any) => o.name).join(", "));
  const meAd = await req("admin", "GET", "/api/v1/me");
  tc("P09", PA, "A staff account keeps its own Freelancer side (not mixed with staff)", "freelancer + admin", (meAd.d.roles ?? []).includes("admin") && (meAd.d.roles ?? []).includes("freelancer"), (meAd.d.roles ?? []).join(", "));
  const inbox = await req("acme", "GET", "/api/v1/inbox");
  const threads = inbox.d.threads ?? inbox.d.items ?? inbox.d ?? [];
  tc("P10", PA, "Inbox threads carry their side", "side on each", Array.isArray(threads) && threads.length > 0 && threads.every((t: any) => "side" in t), `${Array.isArray(threads) ? threads.length : 0} threads`);
  const cal = await req("acme", "GET", "/api/v1/me/calendar");
  const evs = cal.d.events ?? cal.d ?? [];
  tc("P11", PA, "Calendar events carry their side", "side on each", Array.isArray(evs) && evs.length > 0 && evs.every((e: any) => "side" in e), `${Array.isArray(evs) ? evs.length : 0} events`);

  // ================= Trust, safety, disputes =================
  const TA = "Trust and safety";
  await st("T01", TA, "Report a project", "ravi", "POST", "/api/v1/reports", { target_type: "listing", target_id: L.d.id, reason: "spam", details: "Looks duplicated." }, 201);
  await st("T02", TA, "Reporting the same thing twice is refused", "ravi", "POST", "/api/v1/reports", { target_type: "listing", target_id: L.d.id, reason: "spam", details: "Again." }, 409);
  await st("T03", TA, "Reporting your own project is refused", "acme", "POST", "/api/v1/reports", { target_type: "listing", target_id: L.d.id, reason: "spam", details: "Mine." }, 422);
  await st("T04", TA, "Non-staff cannot see the report queue", "ravi", "GET", "/api/v1/admin/reports?status=open", undefined, 404);
  const reps = await req("mod", "GET", "/api/v1/admin/reports?status=open");
  const rep = (reps.d.items ?? reps.d ?? []).find?.((r: any) => r.target_id === L.d.id);
  await st("T05", TA, "Dismissing needs a note", "mod", "POST", `/api/v1/admin/reports/${rep?.id}`, { decision: "dismiss", note: "" }, 422);
  await st("T06", TA, "Moderator dismisses the report with a note", "mod", "POST", `/api/v1/admin/reports/${rep?.id}`, { decision: "dismiss", note: "Not a duplicate." }, 200);
  const q = await req("mod", "GET", "/api/v1/admin/moderation/listings");
  tc("T07", TA, "The held project is in the moderation queue with its findings", "listed", JSON.stringify(q.d).includes(Lscam.d.id), JSON.stringify(q.d).includes(Lscam.d.id) ? "listed" : "missing");
  await st("T08", TA, "Returning a held project needs a note", "mod", "POST", `/api/v1/admin/moderation/listings/${Lscam.d.id}`, { decision: "return", note: "" }, 422);
  await st("T09", TA, "Moderator returns it with a reason", "mod", "POST", `/api/v1/admin/moderation/listings/${Lscam.d.id}`, { decision: "return", note: "Remove the upfront fee request." }, 200);
  await st("T10", TA, "A message moving payment off the platform is refused", "ravi", "POST", `/api/v1/contracts/${order.d.contract_id}/messages`, { body: "Pay me directly by UPI to avoid the fee" }, 422);
  const sig = await db`SELECT count(*)::int AS n FROM trust_signals WHERE user_id = ${R}`.catch(() => [{ n: -1 }]);
  tc("T11", TA, "P1 records that attempt for staff review (no automatic action)", "≥ 1 signal", sig[0].n >= 1, `${sig[0].n} signals`);
  await st("T12", TA, "Risk signals are staff-only", "ravi", "GET", "/api/v1/admin/risk-signals", undefined, 404);
  await st("T13", TA, "Blocking during an open contract is refused", "acme", "POST", "/api/v1/blocks", { freelancer_user_id: R, organization_id: org.id }, 409);
  const D = await st("T14", TA, "Open a dispute on the service order", "ravi", "POST", `/api/v1/contracts/${order.d.contract_id}/dispute`, { reason: "scope", description: "The client asked for three pages instead of the one page in the package.", desired_outcome: "Agree the scope of one page." }, 201);
  await st("T15", TA, "A second dispute on the same contract is refused", "acme", "POST", `/api/v1/contracts/${order.d.contract_id}/dispute`, { reason: "quality", description: "Second dispute while one is open on this contract.", desired_outcome: "x" }, 409);
  await st("T16", TA, "Someone outside the contract cannot open a dispute", "asha", "POST", `/api/v1/contracts/${order.d.contract_id}/dispute`, { reason: "quality", description: "Not my contract at all, testing access.", desired_outcome: "x" }, 404);
  await st("T16b", TA, "Staff cannot decide before the other side answers or 7 days pass (U29)", "admin", "POST", `/api/v1/admin/disputes/${D.d.id}/resolve`, { resolution: "no_action", note: "Deciding right away without the other side." }, 409, (r) => [r.code === "WAITING_FOR_REPLY", r.msg]);
  await st("T16c", TA, "The dispute shows the reply deadline to the parties", "acme", "GET", `/api/v1/contracts/${order.d.contract_id}/dispute`, undefined, 200, (r) => { const d = r.d.dispute ?? r.d; return [typeof d.respond_by === "string" && d.ready_for_decision === false, `answer by ${String(d.respond_by).slice(0, 10)}`]; });
  await st("T17", TA, "The other side adds a statement (staff may now decide)", "acme", "POST", `/api/v1/disputes/${D.d.id}/statements`, { body: "We agreed one page; the extra pages were a question, not a demand." }, [200, 201]);
  await st("T18", TA, "Only the side that opened it can withdraw", "acme", "POST", `/api/v1/disputes/${D.d.id}/withdraw`, {}, 403);
  await st("T19", TA, "Evidence pack for staff", "mod", "GET", `/api/v1/admin/disputes/${D.d.id}`, undefined, 200);
  await st("T20", TA, "A moderator cannot decide an outcome that moves money", "mod", "POST", `/api/v1/admin/disputes/${D.d.id}/resolve`, { resolution: "refund_funded", note: "Refund the client for the extra scope they did not order." }, 403);
  await st("T21", TA, "Admin decides: no money moves", "admin", "POST", `/api/v1/admin/disputes/${D.d.id}/resolve`, { resolution: "no_action", note: "Both agreed to continue with the one-page package." }, 200);
  await st("T22", TA, "A different decision afterwards is refused", "admin", "POST", `/api/v1/admin/disputes/${D.d.id}/resolve`, { resolution: "refund_funded", note: "Changed my mind after reading the messages again." }, 409);
  // Suspension and appeal
  const SU = await signup("spammer", "freelancer", "Spam Account");
  await st("T23", TA, "Staff accounts cannot be suspended", "mod", "POST", `/api/v1/admin/users/${AD}/suspend`, { reason: "Testing staff protection." }, 403);
  const sus = await st("T24", TA, "Moderator suspends an account with a reason", "mod", "POST", `/api/v1/admin/users/${SU}/suspend`, { reason: "Repeated spam proposals." }, 201);
  await st("T25", TA, "A suspended account cannot act (write refused)", "spammer", "PUT", "/api/v1/profile", { ...profile, full_name: "Spam Account" }, 403);
  await st("T26", TA, "A suspended account can still read its suspension and appeal", "spammer", "POST", "/api/v1/me/suspension/appeal", { text: "This was a mistake; I sent proposals to different projects." }, [200, 201]);
  await st("T27", TA, "Appealing twice is refused", "spammer", "POST", "/api/v1/me/suspension/appeal", { text: "Again: this was a mistake, please review my proposals once more." }, 409);
  await st("T28", TA, "The staff member who suspended cannot decide the appeal", "mod", "POST", `/api/v1/admin/suspensions/${sus.d.id}/appeal`, { decision: "overturn", note: "I suspended it; checking I cannot decide." }, 403);
  await st("T29", TA, "A different staff member overturns it", "admin", "POST", `/api/v1/admin/suspensions/${sus.d.id}/appeal`, { decision: "overturn", note: "Proposals were to different projects." }, 200);
  await st("T30", TA, "After the appeal the account can act again", "spammer", "PUT", "/api/v1/profile", { ...profile, full_name: "Spam Account" }, 200);
  // Blocks
  const LBk = many[2];
  await req("ravi", "POST", `/api/v1/marketplace/listings/${LBk}/proposals`, { cover_letter: letter(13), price_minor: 1000000, estimated_days: 9 });
  const bl = await st("T31", TA, "Client blocks a freelancer with no open contract", "acme", "POST", "/api/v1/blocks", { freelancer_user_id: Q, organization_id: org.id, reason: "Not a fit" }, [200, 201]);
  await st("T32", TA, "The blocked freelancer no longer sees that client's projects", "quota", "GET", `/api/v1/marketplace/listings/${many[3]}`, undefined, 404);
  await st("T33", TA, "The blocked freelancer cannot lift the block", "quota", "POST", `/api/v1/blocks/${bl.d.id}/remove`, {}, [403, 404]);
  await st("T34", TA, "A block reason with a phone number is refused", "acme", "POST", "/api/v1/blocks", { freelancer_user_id: F, organization_id: org.id, reason: "call 9876543210" }, [409, 422]);
  await st("T35", TA, "The client lifts the block", "acme", "POST", `/api/v1/blocks/${bl.d.id}/remove`, {}, 200);
  await st("T36", TA, "Staff resolve a support ticket", "mod", "GET", "/api/v1/admin/support/tickets?status=open", undefined, 200);

  // ================= Staff, money and AI =================
  const SA = "Staff, money and AI";
  await st("S01", SA, "Finance drafts a fee schedule", "fin", "POST", "/api/v1/finance/fee-schedules", { name: `Draft ${tag}`, currency: "INR", client_fee_bps: 600, freelancer_fee_bps: 300, min_fee_minor: 0 }, 201);
  await st("S02", SA, "Finance cannot approve fee schedules", "fin", "POST", `/api/v1/finance/fee-schedules/${fsch.d.id}/approve`, {}, [403, 409]);
  await st("S03", SA, "A fee above the allowed range is refused", "fin", "POST", "/api/v1/finance/fee-schedules", { name: `Bad ${tag}`, currency: "INR", client_fee_bps: 9000, freelancer_fee_bps: 300, min_fee_minor: 0 }, 422);
  await st("S04", SA, "Fee quote: ₹30,000 → client pays ₹31,500, freelancer receives ₹29,100", "acme", "GET", "/api/v1/finance/fee-quote?amount_minor=3000000&currency=INR", undefined, 200, (r) => [r.d.client_pays_minor === 3150000 && r.d.freelancer_receives_minor === 2910000, `client ${r.d.client_pays_minor}, freelancer ${r.d.freelancer_receives_minor}`]);
  await st("S05", SA, "Live payments cannot be switched on from the app", "admin", "POST", "/api/v1/admin/flags/payments.live", { enabled: true }, 409);
  await st("S06", SA, "A webhook for a payment provider that is not set up is refused", null, "POST", "/api/v1/payments/webhooks/razorpay", { event: "payment.captured" }, 404, undefined, { "x-signature": "bad" });
  await st("S07", SA, "Trial balance in test mode is balanced", "fin", "GET", "/api/v1/finance/trial-balance?mode=sandbox", undefined, 200, (r) => { const t = r.d.totals?.INR; return [Boolean(t) && t.balanced === true && t.debit_minor === t.credit_minor, t ? `debits ${t.debit_minor} = credits ${t.credit_minor}` : "no totals"]; });
  const bal = await db`SELECT COALESCE(sum(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END), 0)::bigint AS d, COALESCE(sum(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END), 0)::bigint AS c FROM ledger_lines`;
  tc("S08", SA, "Every ledger entry ever written still balances", "debits = credits", bal[0].d === bal[0].c, `${bal[0].d} = ${bal[0].c}`);
  const upd = await db`UPDATE ledger_lines SET amount_minor = amount_minor WHERE false RETURNING 1`.then(() => "ok").catch((e) => String(e.message));
  void upd;
  const tamper = await db`DELETE FROM ledger_lines WHERE id = (SELECT id FROM ledger_lines LIMIT 1)`.then(() => "deleted").catch((e) => String(e.message).slice(0, 60));
  tc("S09", SA, "The database refuses deleting ledger lines", "refused", tamper !== "deleted", tamper);
  await st("S10", SA, "Finance exceptions and reconciliation", "fin", "GET", "/api/v1/admin/finance-exceptions", undefined, 200);
  await st("S11", SA, "Agent self-tests and evaluations all pass", "admin", "GET", "/api/v1/admin/agents/health", undefined, 200, (r) => [r.d.passed === r.d.total && r.d.evaluation?.passed === r.d.evaluation?.cases, `self-tests ${r.d.passed}/${r.d.total}, evaluations ${r.d.evaluation?.passed}/${r.d.evaluation?.cases}`]);
  await st("S12", SA, "A moderator cannot switch agents off", "mod", "POST", "/api/v1/admin/agents/F4", { enabled: false }, [403, 404]);
  await st("S13", SA, "Admin switches F4 off", "admin", "POST", "/api/v1/admin/agents/F4", { enabled: false }, 200);
  await st("S14", SA, "With F4 off, drafting falls back to the template (no AI call)", "ravi", "POST", `/api/v1/marketplace/listings/${many[4]}/proposal-draft`, { price_minor: 1000000 }, [200, 403], (r) => [r.s === 403 || r.d.mode !== "ai", `mode ${r.d.mode ?? r.code}`]);
  await req("admin", "POST", "/api/v1/admin/agents/F4", { enabled: true });
  await st("S15", SA, "P7 supply-and-demand alerts", "admin", "GET", "/api/v1/admin/balance-alerts", undefined, 200);
  await st("S16", SA, "Audit log of staff actions", "admin", "GET", "/api/v1/admin/audit-log", undefined, 200);
  await st("S17", SA, "Find a user by email", "admin", "GET", `/api/v1/admin/users?q=${tag}`, undefined, 200);
  await st("S18", SA, "Closing a category needs a reason", "admin", "POST", "/api/v1/admin/categories/logo_design", { enabled: false, note: "" }, 422);
  await st("S19", SA, "System health shows the database matches this release", "admin", "GET", "/api/v1/admin/health", undefined, 200);
  await st("S20", SA, "Finance cannot open user management", "fin", "GET", `/api/v1/admin/users?q=${tag}`, undefined, [403, 404]);
  await st("S21", SA, "AI usage today is shown per person", "asha", "GET", "/api/v1/me/plan", undefined, 200);
  await st("S22", SA, "F11 business coach answers from records with sources", "asha", "POST", "/api/v1/coach/ask", { question: "Which of my contracts need attention this week?" }, 200);
  await st("S23", SA, "P9 notification settings: account notices cannot be muted", "asha", "PUT", "/api/v1/me/notification-settings", { group_key: "account", in_app: false }, [404, 422]);

  // ================= Security between accounts =================
  const XA = "Security";
  await st("X01", XA, "Someone outside a contract cannot open it", "quota", "GET", `/api/v1/contracts/${K3}`, undefined, 404);
  await st("X02", XA, "…or its workspace", "quota", "GET", `/api/v1/contracts/${K3}/workspace`, undefined, 404);
  await st("X03", XA, "…or its payments", "quota", "GET", `/api/v1/contracts/${K3}/payments`, undefined, 404);
  await st("X04", XA, "Someone outside a client account cannot open it", "ravi", "GET", `/api/v1/organizations/${org.id}`, undefined, 404);
  await st("X05", XA, "…or edit its projects (another client)", "both", "PUT", `/api/v1/listings/${L.d.id}`, { ...listing("Hijack"), base_version: 2 }, 404);
  await st("X06", XA, "…or read the proposals it received (another client)", "both", "GET", `/api/v1/listings/${L.d.id}/proposals`, undefined, 404);
  await st("X07", XA, "A freelancer cannot read another freelancer's proposal", "quota", "GET", `/api/v1/listing-proposals/${P.d.id}/versions`, undefined, 404);
  await st("X08", XA, "…or its discussion", "quota", "GET", `/api/v1/listing-proposals/${P.d.id}/discussion`, undefined, 404);
  await st("X09", XA, "Invalid JSON is refused cleanly", "asha", "PUT", "/api/v1/profile", "{not json", [400, 422]);
  const quoteTitle = `Robert'); DROP TABLE users;-- "quoted" ${tag}`;
  const sq = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing(quoteTitle));
  const stored = await db`SELECT title FROM project_listing_versions WHERE listing_id = ${sq.d.id} ORDER BY version DESC LIMIT 1`.catch(() => []);
  tc("X10", XA, "Text that looks like SQL is stored as plain text", "stored verbatim", sq.s === 201 && stored[0]?.title === quoteTitle, `${sq.s} · ${stored[0]?.title === quoteTitle ? "verbatim" : "changed"}`);
  await st("X11", XA, "Non-staff cannot see the admin area at all (404, not 403)", "acme", "GET", "/api/v1/admin/overview", undefined, 404);
  await st("X12", XA, "Sign out everywhere", "both", "POST", "/api/v1/auth/logout-all", {}, 200);
  await st("X13", XA, "…the old token then fails", "both", "GET", "/api/v1/me", undefined, 401);
  await st("X14", XA, "Contract files are only for the two parties", "quota", "GET", `/api/v1/contracts/${K3}/files`, undefined, [404, 503]);

  // ================= Deadlines when someone stops answering (U29, D-26 to D-29) =================
  const DA = "Deadlines";
  const fund = async (contractId: string, i: number, key: string) => {
    const f = await req("acme", "POST", `/api/v1/contracts/${contractId}/milestones/${i}/fund`, {}, { "Idempotency-Key": key });
    await req("acme", "POST", `/api/v1/payments/sandbox/${f.d.payment?.id}/complete`, { outcome: "succeed" });
  };
  // A second service order, funded and delivered
  const order2 = await req("acme", "POST", `/api/v1/services/${svc.d.id}/order`, { organization_id: org.id, package: "basic", requirements: "Second order: a page for our new branch." });
  const K5 = order2.d.contract_id;
  await req("ravi", "POST", `/api/v1/contracts/${K5}/accept`, { version: 1 });
  await fund(K5, 0, `k5-${tag}`);
  await req("ravi", "POST", `/api/v1/contracts/${K5}/milestones/0/submit`, { note: "Branch page delivered and live.", links: ["https://example.dev/branch"] });
  await st("D01", DA, "A waiting service delivery shows when it completes automatically (3 days)", "acme", "GET", `/api/v1/contracts/${K5}/workspace`, undefined, 200, (r) => { const m = r.d.milestones?.[0]; const days = m?.auto_complete_at ? Math.round((Date.parse(m.auto_complete_at) - Date.now()) / 864e5) : -1; return [r.d.service_order === true && days === 3 && m.review_extensions_left === 2, `in ${days} days, ${m?.review_extensions_left} extensions left`]; });
  await st("D02", DA, "The freelancer cannot extend the client's review", "ravi", "POST", `/api/v1/contracts/${K5}/milestones/0/extend-review`, {}, 403);
  await st("D03", DA, "The client extends the review by 5 days", "acme", "POST", `/api/v1/contracts/${K5}/milestones/0/extend-review`, {}, 200, (r) => [r.d.review_extensions_left === 1, `left ${r.d.review_extensions_left}, until ${String(r.d.auto_complete_at).slice(0, 10)}`]);
  await req("acme", "POST", `/api/v1/contracts/${K5}/milestones/0/extend-review`, {});
  await st("D04", DA, "A third extension is refused", "acme", "POST", `/api/v1/contracts/${K5}/milestones/0/extend-review`, {}, 409, (r) => [r.code === "NO_EXTENSIONS_LEFT", r.code]);
  // A fixed-price project milestone delivered and left unreviewed (must never auto-complete, D-25)
  const L6 = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Logo refresh"));
  await req("acme", "POST", `/api/v1/listings/${L6.d.id}/transition`, { action: "submit" });
  const P6 = await req("ravi", "POST", `/api/v1/marketplace/listings/${L6.d.id}/proposals`, { cover_letter: "I will refresh your logo in two rounds with you, deliver all files and a short usage guide for the shop signs.", price_minor: 800000, estimated_days: 10 });
  const o6 = await req("acme", "POST", `/api/v1/listing-proposals/${P6.d.id}/offer`, { terms: { ...terms2, title: "Logo refresh", milestones: [{ title: "Logo", amount_minor: 800000, due_date: "2027-01-20" }] } });
  const K6 = o6.d.id ?? o6.d.contract_id;
  await req("ravi", "POST", `/api/v1/contracts/${K6}/accept`, { version: 1 });
  await fund(K6, 0, `k6-${tag}`);
  await req("ravi", "POST", `/api/v1/contracts/${K6}/milestones/0/submit`, { note: "Logo files delivered.", links: ["https://example.dev/logo"] });
  await st("D05", DA, "The extend button does not exist for project milestones (no deadline, D-25)", "acme", "POST", `/api/v1/contracts/${K6}/milestones/0/extend-review`, {}, 409, (r) => [r.code === "NOT_A_SERVICE_ORDER", r.code]);
  const earnBefore = (await req("ravi", "GET", "/api/v1/me/earnings")).d;
  const before = earnBefore.available_minor ?? earnBefore.balances?.[0]?.available_minor ?? 0;
  // Run the 6-hourly job with a clock 14 days ahead (after both extensions)
  const later = new Date(Date.now() + 14 * 864e5);
  const job = await autoCompleteServiceDeliveries(db as any, later, async (sqlx, contractId, index) => {
    const r = await decideSubmission(sqlx, contractId, index, "approve", "Completed automatically: the client did not review it within the deadline.", { userId: null, party: "system" });
    return { approved: r.code === "OK", completed: r.code === "OK" && r.completed };
  }, (sqlx, contractId, index) => releaseMilestone(sqlx, contractId, index));
  const k5 = (await db`SELECT status FROM contracts WHERE id = ${K5}`)[0];
  tc("D06", DA, "After the deadline the job approves the service delivery and completes the order", "completed", job.completed >= 1 && k5.status === "completed", `job completed ${job.completed}, contract ${k5.status}`);
  const earnAfter = (await req("ravi", "GET", "/api/v1/me/earnings")).d;
  const after = earnAfter.available_minor ?? earnAfter.balances?.[0]?.available_minor ?? 0;
  tc("D07", DA, "…and releases the funded amount to the freelancer (₹8,000 − 3% = ₹7,760)", "+776000", after - before === 776000, `available ${before} → ${after}`);
  const k6 = (await db`SELECT s.status FROM milestone_submissions s WHERE s.contract_id = ${K6} ORDER BY submitted_at DESC LIMIT 1`)[0];
  tc("D08", DA, "The fixed-price project delivery is untouched by the job (D-25)", "still waiting", k6.status === "submitted", k6.status);
  const ev = await db`SELECT event_type FROM contract_events WHERE contract_id = ${K5} AND event_type = 'milestone.auto_completed'`;
  tc("D09", DA, "The activity log says it was completed automatically", "1 event", ev.length === 1, `${ev.length} event`);
  const job2 = await autoCompleteServiceDeliveries(db as any, later, async (sqlx, contractId, index) => {
    const r = await decideSubmission(sqlx, contractId, index, "approve", "x", { userId: null, party: "system" });
    return { approved: r.code === "OK", completed: r.code === "OK" && r.completed };
  }, (sqlx, contractId, index) => releaseMilestone(sqlx, contractId, index));
  tc("D10", DA, "Running the job again changes nothing", "0 completed", job2.completed === 0, `${job2.completed} completed`);
  // Late milestone: move the agreed due date into the past (as if time passed)
  const lateMove = async (contractId: string, daysAgo: number) => {
    const due = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
    const v = (await db`SELECT c.agreed_version, c.current_version FROM contracts c WHERE c.id = ${contractId}`)[0];
    const row = (await db`SELECT milestones_json FROM contract_versions WHERE contract_id = ${contractId} AND version = ${v.agreed_version ?? v.current_version}`)[0];
    const ms = JSON.parse(row.milestones_json).map((m: any) => ({ ...m, due_date: due }));
    await db`UPDATE contract_versions SET milestones_json = ${JSON.stringify(ms)} WHERE contract_id = ${contractId} AND version = ${v.agreed_version ?? v.current_version}`;
  };
  const L7 = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Flyer design"));
  await req("acme", "POST", `/api/v1/listings/${L7.d.id}/transition`, { action: "submit" });
  const P7 = await req("ravi", "POST", `/api/v1/marketplace/listings/${L7.d.id}/proposals`, { cover_letter: "I will design your opening-day flyer in print and phone sizes, with two rounds of changes and print-ready files.", price_minor: 500000, estimated_days: 5 });
  const o7 = await req("acme", "POST", `/api/v1/listing-proposals/${P7.d.id}/offer`, { terms: { ...terms2, title: "Flyer", milestones: [{ title: "Flyer", amount_minor: 500000, due_date: "2027-01-05" }] } });
  const K7 = o7.d.id ?? o7.d.contract_id;
  await req("ravi", "POST", `/api/v1/contracts/${K7}/accept`, { version: 1 });
  await fund(K7, 0, `k7-${tag}`);
  await lateMove(K7, 0);
  await st("D11", DA, "Due today: not late yet", "acme", "GET", `/api/v1/contracts/${K7}/workspace`, undefined, 200, (r) => [r.d.milestones?.[0]?.late === false && r.d.late_cancel_allowed === false, `late ${r.d.milestones?.[0]?.late}`]);
  await lateMove(K7, 3);
  await st("D12", DA, "Three days past the due date the milestone shows Late and the client may cancel alone", "acme", "GET", `/api/v1/contracts/${K7}/workspace`, undefined, 200, (r) => [r.d.milestones?.[0]?.late === true && r.d.late_cancel_allowed === true, `late ${r.d.milestones?.[0]?.late}, may cancel ${r.d.late_cancel_allowed}`]);
  await st("D13", DA, "The client cancels the late order alone and gets the funded ₹5,250 back", "acme", "POST", `/api/v1/contracts/${K7}/cancellation`, { reason: "The flyer is three days late and our opening is tomorrow." }, 201, (r) => [r.d.cancelled === true && r.d.late === true && r.d.refunded_milestones === 1, r.msg]);
  const ref7 = await db`SELECT COALESCE(sum(total_minor), 0)::bigint AS t FROM payment_intents WHERE contract_id = ${K7} AND status = 'refunded'`;
  tc("D13b", DA, "…the refund is the full ₹5,250 the client paid (₹5,000 + 5% fee)", "525000", Number(ref7[0].t) === 525000, `refunded ${ref7[0].t}`);
  // Cancellation not answered for 48 hours
  const L8 = await req("acme", "POST", `/api/v1/organizations/${org.id}/listings`, listing("Menu photos"));
  await req("acme", "POST", `/api/v1/listings/${L8.d.id}/transition`, { action: "submit" });
  const P8 = await req("ravi", "POST", `/api/v1/marketplace/listings/${L8.d.id}/proposals`, { cover_letter: "I will edit your menu photos for the website and print, keeping colours true to the food, in one week.", price_minor: 400000, estimated_days: 7 });
  const o8 = await req("acme", "POST", `/api/v1/listing-proposals/${P8.d.id}/offer`, { terms: { ...terms2, title: "Menu photos", milestones: [{ title: "Photos", amount_minor: 400000, due_date: "2027-02-01" }] } });
  const K8 = o8.d.id ?? o8.d.contract_id;
  await req("ravi", "POST", `/api/v1/contracts/${K8}/accept`, { version: 1 });
  await fund(K8, 0, `k8-${tag}`);
  await st("D14", DA, "A cancellation request on a contract that is not late waits for the other side, with a 48-hour deadline", "acme", "POST", `/api/v1/contracts/${K8}/cancellation`, { reason: "We are closing the menu project for now." }, 201, (r) => [r.d.cancelled === false && typeof r.d.answer_by === "string", `answer by ${String(r.d.answer_by).slice(0, 16)}`]);
  const expiredNow = await expireCancellationRequests(db as any, new Date(), (sqlx, c, id) => acceptCancellation(sqlx, c, id, { userId: null, party: "system", kind: "expired" }));
  const k8a = (await db`SELECT status FROM contracts WHERE id = ${K8}`)[0];
  tc("D15", DA, "Before 48 hours the job leaves it open", "active", k8a.status === "active", `contract ${k8a.status} (job cancelled ${expiredNow} elsewhere)`);
  await db`UPDATE contract_cancellations SET created_at = now() - interval '49 hours' WHERE contract_id = ${K8} AND status = 'open'`;
  const expiredLater = await expireCancellationRequests(db as any, new Date(), (sqlx, c, id) => acceptCancellation(sqlx, c, id, { userId: null, party: "system", kind: "expired" }));
  const k8b = (await db`SELECT status FROM contracts WHERE id = ${K8}`)[0];
  const refunds8 = await db`SELECT count(*)::int AS n FROM payment_intents WHERE contract_id = ${K8} AND status = 'refunded'`;
  tc("D16", DA, "After 48 hours without an answer the contract is cancelled and the funded milestone refunded", "cancelled, 1 refund", expiredLater >= 1 && k8b.status === "cancelled" && refunds8[0].n === 1, `contract ${k8b.status}, refunds ${refunds8[0].n}`);
  const bal2 = await db`SELECT COALESCE(sum(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END), 0)::bigint AS d, COALESCE(sum(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END), 0)::bigint AS c FROM ledger_lines`;
  tc("D17", DA, "The ledger still balances after automatic releases and refunds", "debits = credits", bal2[0].d === bal2[0].c, `${bal2[0].d} = ${bal2[0].c}`);

  writeFileSync(process.argv[2], JSON.stringify(cases, null, 1));
  const bad = cases.filter((c) => !c.ok);
  console.log(`${cases.length} cases, ${cases.length - bad.length} passed, ${bad.length} not`);
  for (const c of bad) console.log("FAIL", c.id, "|", c.title, "| expected", c.expected, "| got", c.observed);
  await db.end();
  process.exit(0);
})().catch(async (e) => { console.log("CRASH", e?.stack ?? e); writeFileSync(process.argv[2], JSON.stringify(cases, null, 1)); console.log(`${cases.length} cases before the crash`); process.exit(1); });
