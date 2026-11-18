import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { loadRoles, organizationForMember } from "./identity";
import { versionOut } from "./listings";
import type { ListingRow, VersionRow } from "./listings";
import { contractVersionOut } from "./contracts";
import type { ContractRow, ContractVersionRow } from "./contracts";
import { freelancerCard } from "./matching";
import type { CandidateRow } from "./matching";
import { agentEnabled } from "./agents";
import { acceptanceChecklist, compareProposals, suggestTerms } from "./assistants";
import { parseSections, studioSummary } from "./proposal-studio";

/**
 * Deterministic client assistants (Phase 6 batch 2):
 *
 *   GET /api/v1/listings/{id}/proposal-comparison                     C3 (organisation members)
 *   GET /api/v1/listing-proposals/{id}/suggested-terms                C5 (organisation members)
 *   GET /api/v1/contracts/{id}/milestones/{i}/acceptance-check        C6 (client side of the contract)
 *
 * Each checks its registry switch, records an agent run, and only informs:
 * the client makes every decision.
 */

export interface AssistantRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: AssistantRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

async function recordRun(sql: Queryable, userId: string, name: string, summary: string): Promise<void> {
  await sql`
    INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${name}, 'completed', ${summary.slice(0, 500)}, now())
  `;
}

export async function handleAssistantRoute(request: Request, env: Env, requestId: string, deps: AssistantRouteDeps = defaultDeps): Promise<Response | null> {
  if (request.method.toUpperCase() !== "GET") return null;
  const path = new URL(request.url).pathname;
  const compare = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/proposal-comparison$/);
  const suggest = path.match(/^\/api\/v1\/listing-proposals\/([\w-]{1,64})\/suggested-terms$/);
  const check = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/milestones\/(\d{1,2})\/acceptance-check$/);
  if (!compare && !suggest && !check) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    const code = compare ? "C3" : suggest ? "C5" : "C6";
    if (!(await agentEnabled(sql, code))) return failure("AGENT_DISABLED", "This assistant is switched off by the platform.", 403, requestId);

    /* ---------------- C6 ---------------- */
    if (check) {
      const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${check[1]} LIMIT 1`)[0];
      const org = contract ? await organizationForMember(sql, userId, contract.organization_id) : null;
      if (!contract || !org) return failure("NOT_FOUND", "Contract not found", 404, requestId);
      const version = (await sql<ContractVersionRow[]>`
        SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
      `)[0];
      const index = Number(check[2]);
      const terms = version ? contractVersionOut(version) : null;
      if (!terms || index >= terms.milestones.length) return failure("NOT_FOUND", "Milestone not found", 404, requestId);
      const latest = (await sql<{ note: string; links_json: string; status: string }[]>`
        SELECT note, links_json, status FROM milestone_submissions WHERE contract_id = ${contract.id} AND milestone_index = ${index}
        ORDER BY submitted_at DESC LIMIT 1
      `)[0];
      if (!latest) return failure("NOTHING_DELIVERED", "Nothing has been delivered for this milestone yet.", 409, requestId);
      let links: string[] = [];
      try {
        const parsed = JSON.parse(latest.links_json || "[]");
        links = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        links = [];
      }
      const result = acceptanceChecklist(terms.acceptance_criteria, latest.note, links);
      await recordRun(sql, userId, "acceptance_assistant", `Checked milestone ${index + 1} of contract ${contract.id}: ${result.summary}`);
      return success({ milestone: index, title: terms.milestones[index].title, ...result }, "Acceptance checklist", 200, requestId);
    }

    if (!(await loadRoles(sql, userId)).includes("client")) return failure("CLIENT_ROLE_REQUIRED", "Turn on the client (hiring) role first.", 403, requestId);

    /* ---------------- C5 ---------------- */
    if (suggest) {
      const proposal = (await sql<{ id: string; listing_id: string; price_minor: string | number; status: string }[]>`
        SELECT id, listing_id, price_minor, status FROM listing_proposals WHERE id = ${suggest[1]} LIMIT 1
      `)[0];
      const listing = proposal ? (await sql<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${proposal.listing_id} LIMIT 1`)[0] : undefined;
      const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
      if (!proposal || !listing || !org || proposal.status === "withdrawn") return failure("NOT_FOUND", "Proposal not found", 404, requestId);
      const version = (await sql<VersionRow[]>`
        SELECT * FROM project_listing_versions WHERE listing_id = ${listing.id} AND version = ${listing.current_version} LIMIT 1
      `)[0];
      if (!version) return failure("NOT_FOUND", "Listing not found", 404, requestId);
      const brief = versionOut(version);
      const result = suggestTerms(
        {
          title: brief.title,
          deliverables: brief.deliverables,
          milestone_titles: brief.milestones.map((m) => m.title),
          acceptance_criteria: brief.acceptance_criteria,
          revision_rounds: brief.revision_rounds,
          ownership_notes: brief.ownership_notes,
          deadline: brief.deadline,
          price_minor: Number(proposal.price_minor)
        },
        deps.now()
      );
      await recordRun(sql, userId, "contract_assistant", `Suggested ${result.terms.milestones.length} milestones for proposal ${proposal.id}`);
      return success(result, "Suggested terms", 200, requestId);
    }

    /* ---------------- C3 ---------------- */
    const listing = (await sql<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${compare![1]} LIMIT 1`)[0];
    const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
    if (!listing || !org) return failure("NOT_FOUND", "Listing not found", 404, requestId);
    const version = (await sql<VersionRow[]>`
      SELECT * FROM project_listing_versions WHERE listing_id = ${listing.id} AND version = ${listing.current_version} LIMIT 1
    `)[0];
    if (!version) return failure("NOT_FOUND", "Listing not found", 404, requestId);
    const brief = versionOut(version);
    const rows = await sql<Array<{ id: string; price_minor: string | number; estimated_days: number | null; cover_letter: string; invitation_id: string | null; created_at: Date; sections_json: unknown; proposal_version: string | null } & Partial<CandidateRow>>>`
      SELECT p.id, p.price_minor, p.estimated_days, p.cover_letter, p.invitation_id, p.created_at,
             to_jsonb(p)->'sections_json' AS sections_json, to_jsonb(p)->>'current_version' AS proposal_version,
             pr.full_name, pr.headline, pr.skills, pr.services, pr.hourly_rate, pr.weekly_hours, pr.timezone,
             u.created_at AS user_created_at, rt.rating_avg, rt.rating_count
      FROM listing_proposals p
      JOIN users u ON u.id = p.freelancer_user_id
      LEFT JOIN profiles pr ON pr.user_id = p.freelancer_user_id
      LEFT JOIN LATERAL (
        SELECT avg(rv.rating)::float AS rating_avg, count(*)::int AS rating_count
        FROM contract_reviews rv JOIN contracts ct ON ct.id = rv.contract_id
        WHERE ct.freelancer_user_id = p.freelancer_user_id AND rv.reviewer_party = 'client'
          AND (ct.completed_at < now() - interval '14 days'
               OR EXISTS (SELECT 1 FROM contract_reviews rf WHERE rf.contract_id = ct.id AND rf.reviewer_party = 'freelancer'))
      ) rt ON true
      WHERE p.listing_id = ${listing.id} AND p.status IN ('submitted', 'shortlisted', 'offered')
      ORDER BY p.created_at ASC
      LIMIT 50
    `;
    const now = deps.now();
    const comparison = compareProposals(
      { budget_min_minor: brief.budget_min_minor, budget_max_minor: brief.budget_max_minor, deadline: brief.deadline, skills: brief.skills, deliverables: brief.deliverables },
      rows.map((r) => {
        const card = freelancerCard(
          {
            user_id: r.id, full_name: r.full_name ?? "", headline: r.headline ?? "", skills: r.skills ?? "[]", services: r.services ?? "[]",
            minimum_budget: null, hourly_rate: r.hourly_rate ?? null, currency: "INR", weekly_hours: r.weekly_hours ?? null, timezone: r.timezone ?? "",
            dealbreakers: "[]", user_created_at: r.user_created_at ?? now, rating_avg: r.rating_avg, rating_count: r.rating_count
          },
          now
        );
        return {
          id: r.id, freelancer_name: card.display_name, price_minor: Number(r.price_minor), estimated_days: r.estimated_days, cover_letter: r.cover_letter,
          skills: card.skills, rating: card.rating, invited: r.invitation_id !== null, created_at: new Date(r.created_at).toISOString(),
          sections: studioSummary(parseSections(r.sections_json)), version: Number(r.proposal_version ?? 1) || 1
        };
      }),
      now
    );
    await recordRun(sql, userId, "proposal_comparison", `Compared ${comparison.rows.length} proposals for listing ${listing.id}`);
    return success(comparison, "Proposal comparison", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
