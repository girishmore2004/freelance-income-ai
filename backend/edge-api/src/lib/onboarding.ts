import type { Sql } from "./core-routes";

/**
 * Step-by-step start for new users (U31, founder decision D-31, 2026-11-20).
 *
 * Each overview shows a "Get started" list for its side. Prerequisites warn only:
 * nobody is blocked, but pages show what is missing and why it matters.
 * - Client profile before posting: account type, name, country, industry.
 * - Billing name and email before the first payment.
 * - Freelancer profile before proposals or services: name, headline, 3+ skills,
 *   bio of 50+ characters, hourly rate.
 * Pure rules first (tested), then the facts query.
 */

export type Gap = { key: string; label: string };
export type OnboardingStep = { key: string; label: string; why: string; href: string; done: boolean };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim());
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String).filter((s) => s.trim()) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const FREELANCER_PROFILE_RULES = { headline: 10, skills: 3, bio: 50 } as const;

/** What a freelancer profile still needs (D-31 "Standard"). Pure. */
export function freelancerProfileGaps(p: Record<string, unknown> | null | undefined): Gap[] {
  const gaps: Gap[] = [];
  if (text(p?.full_name).length < 2) gaps.push({ key: "full_name", label: "Your name" });
  if (text(p?.headline).length < FREELANCER_PROFILE_RULES.headline) gaps.push({ key: "headline", label: "A one-line headline (10+ characters)" });
  if (list(p?.skills).length < FREELANCER_PROFILE_RULES.skills) gaps.push({ key: "skills", label: "At least 3 skills" });
  if (text(p?.bio).length < FREELANCER_PROFILE_RULES.bio) gaps.push({ key: "bio", label: "A short bio (50+ characters)" });
  if (!(Number(p?.hourly_rate ?? 0) > 0)) gaps.push({ key: "hourly_rate", label: "Your hourly rate" });
  return gaps;
}

/** What a client profile still needs before posting (D-31). Pure. */
export function clientProfileGaps(o: Record<string, unknown> | null | undefined): Gap[] {
  const gaps: Gap[] = [];
  if (!["individual", "company"].includes(text(o?.kind))) gaps.push({ key: "kind", label: "Account type" });
  if (text(o?.name).length < 2) gaps.push({ key: "name", label: "Name" });
  if (!/^[A-Za-z]{2}$/.test(text(o?.country))) gaps.push({ key: "country", label: "Country" });
  if (text(o?.industry).length < 2) gaps.push({ key: "industry", label: "Industry" });
  return gaps;
}

/** Billing details needed before the first payment (D-31). Pure. */
export function billingGaps(o: Record<string, unknown> | null | undefined): Gap[] {
  const gaps: Gap[] = [];
  if (text(o?.billing_name).length < 2) gaps.push({ key: "billing_name", label: "Billing name" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(o?.billing_email))) gaps.push({ key: "billing_email", label: "Billing email" });
  return gaps;
}

export type ClientFacts = { profile: Record<string, unknown> | null; listings: number; proposals: number; invitations: number; contracts: number; funded: number; approved: number };
export type FreelancerFacts = { profile: Record<string, unknown> | null; visible: boolean; proposals: number; contracts: number; deliveries: number; paid: number };

/** The client's steps, in order. Pure. */
export function clientSteps(f: ClientFacts): OnboardingStep[] {
  return [
    { key: "profile", label: "Complete your client profile", why: "Freelancers trust complete profiles and reply sooner.", href: "/client/profile", done: clientProfileGaps(f.profile).length === 0 },
    { key: "post", label: "Post your first project", why: "Four short steps; fields marked ★ are required.", href: "/client/projects", done: f.listings > 0 },
    { key: "proposals", label: "Get proposals or invite freelancers", why: "Matched freelancers are suggested as soon as you publish.", href: "/client/projects", done: f.proposals > 0 || f.invitations > 0 },
    { key: "hire", label: "Hire: send an offer the freelancer accepts", why: "Milestones, price and acceptance criteria are agreed in the offer.", href: "/client/projects", done: f.contracts > 0 },
    { key: "billing", label: "Add billing name and email", why: "Needed on invoices before your first payment.", href: "/client/profile", done: billingGaps(f.profile).length === 0 },
    { key: "fund", label: "Fund the first milestone", why: "The freelancer starts once it is funded (test mode for now).", href: "/contracts", done: f.funded > 0 },
    { key: "approve", label: "Approve a delivery and pay", why: "Approving releases the funded amount to the freelancer.", href: "/contracts", done: f.approved > 0 },
  ];
}

/** The freelancer's steps, in order. Pure. */
export function freelancerSteps(f: FreelancerFacts): OnboardingStep[] {
  return [
    { key: "profile", label: "Complete your profile", why: "Name, headline, 3+ skills, a short bio and your hourly rate.", href: "/profile", done: freelancerProfileGaps(f.profile).length === 0 },
    { key: "visible", label: "Show your profile to clients", why: "Clients can only invite freelancers who opted in.", href: "/projects", done: f.visible },
    { key: "proposal", label: "Send your first proposal", why: "Start with “Projects for you”; they match your skills.", href: "/projects", done: f.proposals > 0 },
    { key: "contract", label: "Win a contract", why: "Accept the client's offer to start.", href: "/contracts", done: f.contracts > 0 },
    { key: "deliver", label: "Deliver your first milestone", why: "Deliver from the contract workspace with a note and links.", href: "/contracts", done: f.deliveries > 0 },
    { key: "paid", label: "Get paid", why: "The client's approval releases the payment to your earnings.", href: "/earnings", done: f.paid > 0 },
  ];
}

/** Summary sent to the page: steps, the next step and the profile gaps. Pure. */
export function onboardingOut(side: "client" | "freelancer", steps: OnboardingStep[], gaps: { profile: Gap[]; billing?: Gap[] }) {
  const next = steps.find((s) => !s.done) ?? null;
  return { side, steps, next: next?.key ?? null, done: steps.filter((s) => s.done).length, total: steps.length, complete: next === null, profile_gaps: gaps.profile, billing_gaps: gaps.billing ?? [] };
}

const count = async (q: Promise<Array<{ n: number }>>) => (await q.catch(() => [{ n: 0 }]))[0]?.n ?? 0;

/** The client's first managed client account (owner or admin), or null. */
export async function primaryClientAccount(sql: Sql, userId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql<Array<{ o: Record<string, unknown> }>>`
    SELECT to_jsonb(o) AS o FROM organizations o JOIN organization_memberships m ON m.organization_id = o.id
    WHERE m.user_id = ${userId} AND m.status = 'active' AND m.role IN ('owner', 'admin')
    ORDER BY (m.role = 'owner') DESC, o.created_at ASC LIMIT 1
  `.catch(() => []);
  return rows[0]?.o ?? null;
}

export async function clientFacts(sql: Sql, userId: string): Promise<ClientFacts> {
  const profile = await primaryClientAccount(sql, userId);
  const orgId = String(profile?.id ?? "");
  if (!orgId) return { profile: null, listings: 0, proposals: 0, invitations: 0, contracts: 0, funded: 0, approved: 0 };
  const [listings, proposals, invitations, contracts, funded, approved] = await Promise.all([
    count(sql`SELECT count(*)::int AS n FROM project_listings WHERE organization_id = ${orgId}`),
    count(sql`SELECT count(*)::int AS n FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id WHERE l.organization_id = ${orgId}`),
    count(sql`SELECT count(*)::int AS n FROM listing_invitations i JOIN project_listings l ON l.id = i.listing_id WHERE l.organization_id = ${orgId}`),
    count(sql`SELECT count(*)::int AS n FROM contracts WHERE organization_id = ${orgId} AND status IN ('active', 'completed')`),
    count(sql`SELECT count(*)::int AS n FROM payment_intents i JOIN contracts c ON c.id = i.contract_id WHERE c.organization_id = ${orgId} AND i.status IN ('funded', 'released')`),
    count(sql`SELECT count(*)::int AS n FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id WHERE c.organization_id = ${orgId} AND s.status = 'approved'`),
  ]);
  return { profile, listings, proposals, invitations, contracts, funded, approved };
}

export async function freelancerFacts(sql: Sql, userId: string): Promise<FreelancerFacts> {
  const profile = (await sql<Array<{ p: Record<string, unknown> }>>`SELECT to_jsonb(p) AS p FROM profiles p WHERE p.user_id = ${userId} LIMIT 1`.catch(() => []))[0]?.p ?? null;
  const [proposals, contracts, deliveries, paid] = await Promise.all([
    count(sql`SELECT count(*)::int AS n FROM listing_proposals WHERE freelancer_user_id = ${userId}`),
    count(sql`SELECT count(*)::int AS n FROM contracts WHERE freelancer_user_id = ${userId} AND status IN ('active', 'completed')`),
    count(sql`SELECT count(*)::int AS n FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id WHERE c.freelancer_user_id = ${userId}`),
    count(sql`SELECT count(*)::int AS n FROM payment_intents i JOIN contracts c ON c.id = i.contract_id WHERE c.freelancer_user_id = ${userId} AND i.status = 'released'`),
  ]);
  return { profile, visible: Boolean(profile?.marketplace_visible), proposals, contracts, deliveries, paid };
}
