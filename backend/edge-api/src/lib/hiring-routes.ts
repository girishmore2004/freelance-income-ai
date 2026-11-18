import type { Env } from "../types";
import { notifyUsers, organizationManagers } from "./notify";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, draftProposal, jsonList } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import type { ListingRow, VersionRow } from "./listings";
import { freelancerCard } from "./matching";
import { recordContractEvent } from "./contract-events";
import type { CandidateRow } from "./matching";
import {
  OPEN_PROPOSAL_STATUSES,
  contractActions,
  contractVersionOut,
  hasPendingChange,
  lockedMilestoneErrors,
  proposalOut,
  termsHash,
  validateProposal,
  validateTerms
} from "./contracts";
import type { ContractRow, ContractTerms, ContractVersionRow, Party, ProposalRow } from "./contracts";
import { checkProposal, contentHash, describeChanges, parseSections, rankEvidence, validateSections } from "./proposal-studio";
import type { ProposalSections, StudioContent } from "./proposal-studio";
import { screenText, versionOut } from "./listings";

/**
 * Hiring loop (Phase 3 batch 1):
 *
 * Freelancer
 *   POST /api/v1/marketplace/listings/{id}/proposals {cover_letter, price_minor, estimated_days}
 *   POST /api/v1/marketplace/listings/{id}/proposal-check {…same body}  Proposal Studio checks + content hash (no write)
 *   POST /api/v1/marketplace/listings/{id}/proposal-draft {price_minor?}  F4 draft from confirmed profile facts (governed AI, reviewed text)
 *   GET  /api/v1/me/proposals
 *   GET  /api/v1/listing-proposals/{id}/versions     version history (freelancer or client organisation member)
 *   PUT  /api/v1/listing-proposals/{id}              edit while submitted/shortlisted
 *   POST /api/v1/listing-proposals/{id}/withdraw
 * Client (client role + membership; changes need owner/admin)
 *   GET  /api/v1/listings/{id}/proposals
 *   POST /api/v1/listing-proposals/{id}/status {action: shortlist|decline|request_revision, note?}
 *   POST /api/v1/listing-proposals/{id}/offer {terms}         → contract v1, accepted by the client
 * Both parties
 *   GET  /api/v1/contracts                            contracts I am a party to
 *   GET  /api/v1/contracts/{id}                       terms, versions, acceptance, allowed actions
 *   POST /api/v1/contracts/{id}/accept {version}      both parties accept the same version → active
 *   POST /api/v1/contracts/{id}/versions {base_version, terms}   propose changed terms (needs the other side)
 *   POST /api/v1/contracts/{id}/decline               freelancer, while offered
 *   POST /api/v1/contracts/{id}/withdraw              client owner/admin, while offered
 *
 * Behind `marketplace.client_side`. No money moves here: funding milestones
 * stays disabled until `payments.live` is approved (D-1/D-2).
 */

export interface HiringRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: HiringRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

const DISABLED = "The client marketplace is not open yet.";
const PAYMENTS_OFF = "Milestone funding is not available yet. Payments open only after the payment provider, legal and accounting checks are approved.";

type ProposalWithCard = ProposalRow & {
  full_name: string | null;
  headline: string | null;
  skills: string | null;
  services: string | null;
  minimum_budget: CandidateRow["minimum_budget"];
  hourly_rate: CandidateRow["hourly_rate"];
  profile_currency: string | null;
  weekly_hours: number | null;
  timezone: string | null;
  user_created_at: Date;
};

async function proposalForUpdate(tx: Queryable, id: string): Promise<ProposalRow | null> {
  return (await tx<ProposalRow[]>`SELECT * FROM listing_proposals WHERE id = ${id} FOR UPDATE`)[0] ?? null;
}

/** True once migration 0067 (Proposal Studio) has run; until then only the older single-text proposal works. */
async function studioReady(sql: Queryable): Promise<boolean> {
  const rows = await sql<{ ready: boolean }[]>`SELECT to_regclass('listing_proposal_versions') IS NOT NULL AS ready`;
  return rows[0]?.ready === true;
}

async function freelancerEvidence(sql: Queryable, userId: string): Promise<{ skills: string[]; portfolio_links: string[] }> {
  const row = (await sql<{ skills: unknown; portfolio_links: unknown }[]>`SELECT skills, portfolio_links FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0];
  return { skills: row ? jsonList(row.skills) : [], portfolio_links: row ? jsonList(row.portfolio_links) : [] };
}

/** Validates a proposal body including optional Studio sections and the approved hash. */
async function studioInput(
  payload: Record<string, unknown>,
  portfolioLinks: string[]
): Promise<{ ok: true; content: StudioContent; hash: string } | { ok: false; errors: Record<string, string> } | { ok: false; mismatch: true }> {
  const base = validateProposal(payload);
  const sections = validateSections(payload.sections, portfolioLinks);
  if (!base.ok || !sections.ok) return { ok: false, errors: { ...(base.ok ? {} : base.errors), ...(sections.ok ? {} : sections.errors) } };
  const content: StudioContent = { ...base.value, sections: sections.value };
  const hash = await contentHash(content);
  if (payload.approved_hash !== undefined && payload.approved_hash !== hash) return { ok: false, mismatch: true };
  return { ok: true, content, hash };
}

async function insertProposalVersion(tx: Queryable, proposalId: string, version: number, content: StudioContent, hash: string, userId: string): Promise<void> {
  await tx`
    INSERT INTO listing_proposal_versions (id, proposal_id, version, cover_letter, price_minor, estimated_days, sections_json, content_hash, created_by, created_at)
    VALUES (${crypto.randomUUID()}, ${proposalId}, ${version}, ${content.cover_letter}, ${content.price_minor}, ${content.estimated_days},
            ${content.sections ? JSON.stringify(content.sections) : null}, ${hash}, ${userId}, now())
  `;
}

/**
 * F4 Proposal Agent on a native listing: drafts an introduction from the
 * freelancer's confirmed profile facts through the AI governor; the output
 * passes the deterministic guard or a safe template is returned. Nothing is
 * saved or sent: the text goes into the Studio editor for the freelancer.
 */
async function draftForListing(env: Env, sql: Sql, userId: string, listingId: string, rawPrice: unknown, requestId: string): Promise<Response> {
  const rows = await sql<(VersionRow & { visibility: string; status: string; is_member: boolean; invited: boolean })[]>`
    SELECT v.*, l.visibility, l.status,
           EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = l.organization_id AND m.user_id = ${userId}) AS is_member,
           EXISTS (SELECT 1 FROM listing_invitations i WHERE i.listing_id = l.id AND i.freelancer_user_id = ${userId} AND i.status IN ('pending', 'accepted')) AS invited
    FROM project_listings l
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = ${listingId} AND o.status = 'active'
    LIMIT 1
  `;
  const listing = rows[0];
  if (!listing || listing.is_member || (listing.visibility !== "public" && !listing.invited) || listing.status !== "published") {
    return failure("NOT_FOUND", "Project not found", 404, requestId);
  }
  const profile = (await sql<Record<string, unknown>[]>`
    SELECT full_name, headline, bio, skills, portfolio_links FROM profiles WHERE user_id = ${userId} LIMIT 1
  `)[0];
  if (!profile || jsonList(profile.skills).length === 0) {
    return failure("PROFILE_INCOMPLETE", "Add your skills to your profile first: drafts use only facts you confirmed there.", 409, requestId);
  }
  const price = typeof rawPrice === "number" && Number.isInteger(rawPrice) && rawPrice >= 100 ? rawPrice / 100 : null;
  const b = versionOut(listing);
  const opp = { title: b.title, description: [b.outcome, b.description, b.deliverables.length ? `Deliverables: ${b.deliverables.join("; ")}` : ""].filter(Boolean).join("\n"), currency: b.currency };
  const draft = await draftProposal(env, profile, opp, price, { sql, userId });
  return success(
    { cover_letter: draft.content, mode: draft.mode, ai_note: draft.ai_note ?? null },
    draft.mode === "model" ? "Draft ready: check every sentence before you use it" : "Template ready: AI drafting was not available",
    200,
    requestId
  );
}

const APPROVAL_MISMATCH = "The proposal changed after you reviewed it. Review the final version again, then submit.";

async function contractVersion(sql: Queryable, contract: ContractRow): Promise<ContractVersionRow | null> {
  return (
    (await sql<ContractVersionRow[]>`
      SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.current_version} LIMIT 1
    `)[0] ?? null
  );
}

async function insertContractVersion(tx: Queryable, contractId: string, version: number, terms: ContractTerms, hash: string, party: Party, userId: string): Promise<void> {
  await tx`
    INSERT INTO contract_versions
      (id, contract_id, version, title, scope, deliverables_json, milestones_json, total_minor, currency, revision_rounds,
       acceptance_json, ownership_terms, content_hash, proposed_by, created_by, created_at,
       client_accepted_at, client_accepted_by, freelancer_accepted_at)
    VALUES
      (${crypto.randomUUID()}, ${contractId}, ${version}, ${terms.title}, ${terms.scope}, ${JSON.stringify(terms.deliverables)},
       ${JSON.stringify(terms.milestones)}, ${terms.total_minor}, ${terms.currency}, ${terms.revision_rounds},
       ${JSON.stringify(terms.acceptance_criteria)}, ${terms.ownership_terms}, ${hash}, ${party}, ${userId}, now(),
       ${party === "client" ? new Date().toISOString() : null}, ${party === "client" ? userId : null},
       ${party === "freelancer" ? new Date().toISOString() : null})
  `;
}

/** Resolves which side of a contract the user is on (null = no access → 404). */
async function partyOf(sql: Queryable, userId: string, contract: ContractRow): Promise<{ party: Party; canManage: boolean } | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  if (!org) return null;
  return { party: "client", canManage: canManageOrganization(org.membership_role) };
}

export async function handleHiringRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: HiringRouteDeps = defaultDeps
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const propose = path.match(/^\/api\/v1\/marketplace\/listings\/([\w-]{1,64})\/(proposals|proposal-check|proposal-draft)$/);
  const meProposals = path === "/api/v1/me/proposals";
  const proposal = path.match(/^\/api\/v1\/listing-proposals\/([\w-]{1,64})(?:\/(withdraw|status|offer|versions))?$/);
  const listingProposals = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/proposals$/);
  const contracts = path === "/api/v1/contracts";
  const contract = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})(?:\/(accept|versions|decline|withdraw|reject-change))?$/);

  const known =
    (propose !== null && method === "POST") ||
    (meProposals && method === "GET") ||
    (proposal !== null && (proposal[2] === "versions" ? method === "GET" : proposal[2] ? method === "POST" : method === "PUT")) ||
    (listingProposals !== null && method === "GET") ||
    (contracts && method === "GET") ||
    (contract !== null && (contract[2] ? method === "POST" : method === "GET"));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
      return failure("FEATURE_DISABLED", DISABLED, 403, requestId);
    }
    const roles = await loadRoles(sql, userId);

    /* ---------------- freelancer: submit a proposal ---------------- */
    if (propose) {
      if (!roles.includes("freelancer")) return failure("FREELANCER_ROLE_REQUIRED", "Turn on the freelancer role first.", 403, requestId);
      const payload = (await body(request)) ?? {};
      if (propose[2] === "proposal-draft") return await draftForListing(env, sql, userId, propose[1], payload.price_minor, requestId);
      const isCheck = propose[2] === "proposal-check";
      const ready = await studioReady(sql);
      if (!ready && (payload.sections !== undefined || isCheck)) {
        return failure("MIGRATION_PENDING", "Proposal Studio needs database migration 0067. Use the short proposal form until it runs.", 503, requestId);
      }
      const evidence = await freelancerEvidence(sql, userId);
      const parsed = await studioInput(payload, evidence.portfolio_links);
      if (!parsed.ok && "mismatch" in parsed) return failure("APPROVAL_MISMATCH", APPROVAL_MISMATCH, 409, requestId);
      if (!parsed.ok) return failure("INVALID_PROPOSAL", "Check the highlighted fields.", 422, requestId, [parsed.errors]);
      const input = parsed.content;

      const rows = await sql<(ListingRow & { budget_model: string; currency: string; invitation_id: string | null; is_member: boolean })[]>`
        SELECT l.*, v.budget_model, v.currency,
               (SELECT i.id FROM listing_invitations i
                 WHERE i.listing_id = l.id AND i.freelancer_user_id = ${userId} AND i.status IN ('pending', 'accepted') LIMIT 1) AS invitation_id,
               EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = l.organization_id AND m.user_id = ${userId}) AS is_member
        FROM project_listings l
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        JOIN organizations o ON o.id = l.organization_id
        WHERE l.id = ${propose[1]} AND o.status = 'active'
        LIMIT 1
      `;
      const listing = rows[0];
      const visible = listing && (listing.visibility === "public" || listing.invitation_id !== null);
      if (!listing || !visible || listing.is_member) return failure("NOT_FOUND", "Project not found", 404, requestId);
      if (isCheck) {
        const brief = (await sql<VersionRow[]>`
          SELECT * FROM project_listing_versions WHERE listing_id = ${listing.id} AND version = ${listing.current_version} LIMIT 1
        `)[0];
        if (!brief) return failure("NOT_FOUND", "Project not found", 404, requestId);
        const b = versionOut(brief);
        const findings = checkProposal(
          input,
          { budget_model: b.budget_model, budget_min_minor: b.budget_min_minor, budget_max_minor: b.budget_max_minor, deadline: b.deadline, skills: b.skills, deliverables: b.deliverables, revision_rounds: b.revision_rounds },
          evidence,
          deps.now()
        );
        return success(
          { content_hash: parsed.hash, findings, evidence_suggestions: rankEvidence(evidence.portfolio_links, { title: b.title, skills: b.skills }) },
          findings.some((f) => f.severity === "warn") ? "Review the flagged points before submitting" : "No problems found",
          200,
          requestId
        );
      }
      if (listing.status !== "published" || (listing.closes_at && new Date(listing.closes_at) <= deps.now())) {
        return failure("LISTING_NOT_OPEN", "This project is not taking proposals.", 409, requestId);
      }
      const newId = crypto.randomUUID();
      const inserted = ready
        ? await sql.begin(async (tx) => {
            const rows = await tx<ProposalRow[]>`
              INSERT INTO listing_proposals
                (id, listing_id, freelancer_user_id, invitation_id, status, cover_letter, price_minor, currency, budget_model,
                 estimated_days, sections_json, current_version, content_hash, created_at, updated_at)
              VALUES (${newId}, ${listing.id}, ${userId}, ${listing.invitation_id}, 'submitted', ${input.cover_letter},
                      ${input.price_minor}, ${listing.currency}, ${listing.budget_model}, ${input.estimated_days},
                      ${input.sections ? JSON.stringify(input.sections) : null}, 1, ${parsed.hash}, now(), now())
              ON CONFLICT (listing_id, freelancer_user_id) DO NOTHING
              RETURNING *
            `;
            if (rows[0]) await insertProposalVersion(tx, newId, 1, input, parsed.hash, userId);
            return rows;
          })
        : await sql<ProposalRow[]>`
            INSERT INTO listing_proposals
              (id, listing_id, freelancer_user_id, invitation_id, status, cover_letter, price_minor, currency, budget_model,
               estimated_days, created_at, updated_at)
            VALUES (${newId}, ${listing.id}, ${userId}, ${listing.invitation_id}, 'submitted', ${input.cover_letter},
                    ${input.price_minor}, ${listing.currency}, ${listing.budget_model}, ${input.estimated_days}, now(), now())
            ON CONFLICT (listing_id, freelancer_user_id) DO NOTHING
            RETURNING *
          `;
      if (!inserted[0]) return failure("ALREADY_PROPOSED", "You already sent a proposal for this project. Edit it instead.", 409, requestId);
      if (listing.invitation_id) {
        await sql`UPDATE listing_invitations SET status = 'accepted', responded_at = COALESCE(responded_at, now()) WHERE id = ${listing.invitation_id} AND status = 'pending'`;
      }
      await notifyUsers(sql, await organizationManagers(sql, listing.organization_id), {
        kind: "proposal.received",
        title: "You received a new proposal",
        message: "Open Client projects → Proposals to review it.",
        link: "/client/projects",
        dedupe: `proposal:${inserted[0].id}`
      });
      return success(proposalOut(inserted[0]), "Proposal sent", 201, requestId);
    }

    if (meProposals) {
      const rows = await sql<(ProposalRow & { title: string; listing_status: string; contract_id: string | null; contract_status: string | null })[]>`
        SELECT p.*, v.title, l.status AS listing_status, c.id AS contract_id, c.status AS contract_status
        FROM listing_proposals p
        JOIN project_listings l ON l.id = p.listing_id
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        LEFT JOIN contracts c ON c.proposal_id = p.id AND c.status IN ('offered', 'active')
        WHERE p.freelancer_user_id = ${userId}
        ORDER BY p.created_at DESC
        LIMIT 100
      `;
      return success(
        rows.map((r) => ({ ...proposalOut(r), project_title: r.title, listing_status: r.listing_status, contract_id: r.contract_id, contract_status: r.contract_status })),
        "Your proposals",
        200,
        requestId
      );
    }

    /* ---------------- one proposal ---------------- */
    if (proposal) {
      const proposalId = proposal[1];
      const action = proposal[2];

      // Freelancer edits or withdraws their own proposal.
      if (action === "versions") {
        if (!(await studioReady(sql))) return success({ versions: [] }, "Version history needs database migration 0067", 200, requestId);
        const owner = (await sql<{ freelancer_user_id: string; organization_id: string; status: string }[]>`
          SELECT p.freelancer_user_id, l.organization_id, p.status FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id WHERE p.id = ${proposalId} LIMIT 1
        `)[0];
        const allowed = owner && (owner.freelancer_user_id === userId || (owner.status !== "withdrawn" && (await organizationForMember(sql, userId, owner.organization_id)) !== null));
        if (!owner || !allowed) return failure("NOT_FOUND", "Proposal not found", 404, requestId);
        const rows = await sql<Array<{ version: number; cover_letter: string; price_minor: string | number; estimated_days: number | null; sections_json: unknown; content_hash: string | null; created_at: Date }>>`
          SELECT version, cover_letter, price_minor, estimated_days, sections_json, content_hash, created_at
          FROM listing_proposal_versions WHERE proposal_id = ${proposalId} ORDER BY version ASC LIMIT 100
        `;
        const versions = rows.map((r) => ({
          version: r.version,
          cover_letter: r.cover_letter,
          price_minor: Number(r.price_minor),
          estimated_days: r.estimated_days,
          sections: parseSections(r.sections_json),
          content_hash: r.content_hash,
          created_at: new Date(r.created_at).toISOString()
        }));
        return success(
          { versions: versions.map((v, i) => ({ ...v, changes: i === 0 ? ["First version"] : describeChanges(versions[i - 1], v) })).reverse() },
          "Proposal versions",
          200,
          requestId
        );
      }

      if (!action || action === "withdraw") {
        const payload = action ? {} : (await body(request)) ?? {};
        const ready = action ? false : await studioReady(sql);
        if (!action && !ready && payload.sections !== undefined) {
          return failure("MIGRATION_PENDING", "Proposal Studio needs database migration 0067. Use the short proposal form until it runs.", 503, requestId);
        }
        const parsed = action ? null : await studioInput(payload, (await freelancerEvidence(sql, userId)).portfolio_links);
        if (parsed && !parsed.ok && "mismatch" in parsed) return failure("APPROVAL_MISMATCH", APPROVAL_MISMATCH, 409, requestId);
        if (parsed && !parsed.ok) return failure("INVALID_PROPOSAL", "Check the highlighted fields.", 422, requestId, [parsed.errors]);
        const result = await sql.begin(async (tx) => {
          const row = await proposalForUpdate(tx, proposalId);
          if (!row || row.freelancer_user_id !== userId) return { code: "NOT_FOUND" as const };
          if (!OPEN_PROPOSAL_STATUSES.includes(row.status)) return { code: "CLOSED" as const, status: row.status };
          if (action === "withdraw") {
            const updated = await tx<ProposalRow[]>`
              UPDATE listing_proposals SET status = 'withdrawn', decided_at = now(), updated_at = now() WHERE id = ${proposalId} RETURNING *
            `;
            return { code: "OK" as const, row: updated[0] };
          }
          if (!parsed || !parsed.ok) return { code: "NOT_FOUND" as const };
          const input = parsed.content;
          if (!ready) {
            const updated = await tx<ProposalRow[]>`
              UPDATE listing_proposals SET cover_letter = ${input.cover_letter}, price_minor = ${input.price_minor},
                estimated_days = ${input.estimated_days}, updated_at = now()
              WHERE id = ${proposalId} RETURNING *
            `;
            return { code: "OK" as const, row: updated[0] };
          }
          if (row.content_hash === parsed.hash) return { code: "OK" as const, row };
          const next = Number(row.current_version ?? 1) + 1;
          const updated = await tx<ProposalRow[]>`
            UPDATE listing_proposals SET cover_letter = ${input.cover_letter}, price_minor = ${input.price_minor},
              estimated_days = ${input.estimated_days}, sections_json = ${input.sections ? JSON.stringify(input.sections) : null},
              content_hash = ${parsed.hash}, current_version = ${next}, revision_requested_at = NULL, revision_note = NULL, updated_at = now()
            WHERE id = ${proposalId} RETURNING *
          `;
          await insertProposalVersion(tx, proposalId, next, input, parsed.hash, userId);
          return { code: "OK" as const, row: updated[0], revised: true, listingId: row.listing_id };
        });
        if (result.code === "NOT_FOUND") return failure("NOT_FOUND", "Proposal not found", 404, requestId);
        if (result.code === "CLOSED") return failure("PROPOSAL_CLOSED", `This proposal is ${result.status} and can no longer change.`, 409, requestId);
        if ("revised" in result && result.revised) {
          const org = (await sql<{ organization_id: string }[]>`SELECT organization_id FROM project_listings WHERE id = ${result.listingId} LIMIT 1`)[0];
          if (org) {
            await notifyUsers(sql, await organizationManagers(sql, org.organization_id), {
              kind: "proposal.revised",
              title: "A freelancer revised their proposal",
              message: `Version ${result.row.current_version} is ready. Open Client projects → Proposals to compare versions.`,
              link: "/client/projects",
              dedupe: `proposal-version:${result.row.id}:${result.row.current_version}`
            });
          }
        }
        return success(proposalOut(result.row), action ? "Proposal withdrawn" : "Proposal updated", 200, requestId);
      }

      // Client decisions.
      if (!roles.includes("client")) return failure("CLIENT_ROLE_REQUIRED", "Turn on the client (hiring) role first.", 403, requestId);
      const lookup = await sql<(ProposalRow & { organization_id: string; listing_status: string; listing_currency: string })[]>`
        SELECT p.*, l.organization_id, l.status AS listing_status, v.currency AS listing_currency
        FROM listing_proposals p
        JOIN project_listings l ON l.id = p.listing_id
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        WHERE p.id = ${proposalId} LIMIT 1
      `;
      const found = lookup[0];
      const org = found ? await organizationForMember(sql, userId, found.organization_id) : null;
      if (!found || !org || found.status === "withdrawn") return failure("NOT_FOUND", "Proposal not found", 404, requestId);
      if (!canManageOrganization(org.membership_role)) return failure("FORBIDDEN", "Only owners and admins can decide on proposals.", 403, requestId);
      const payload = (await body(request)) ?? {};

      if (action === "status") {
        const decision = payload.action;
        if (decision === "request_revision") {
          const note = typeof payload.note === "string" ? payload.note.trim() : "";
          if (note.length < 5 || note.length > 1000) return failure("INVALID_NOTE", "Say what you would like changed (5 to 1,000 characters).", 422, requestId);
          if (screenText(note).length) return failure("INVALID_NOTE", "Keep contact and payment on the platform: remove contact details or payment requests.", 422, requestId);
          if (!(await studioReady(sql))) return failure("MIGRATION_PENDING", "Revision requests need database migration 0067.", 503, requestId);
          const updated = await sql<ProposalRow[]>`
            UPDATE listing_proposals SET revision_requested_at = now(), revision_note = ${note}, updated_at = now()
            WHERE id = ${proposalId} AND status IN ('submitted', 'shortlisted')
            RETURNING *
          `;
          if (!updated[0]) return failure("PROPOSAL_CLOSED", "This proposal can no longer change.", 409, requestId);
          await notifyUsers(sql, [updated[0].freelancer_user_id], {
            kind: "proposal.revision_requested",
            title: "The client asked for a revised proposal",
            message: note.slice(0, 200),
            link: "/projects",
            dedupe: `proposal-revision:${updated[0].id}:${new Date(updated[0].updated_at).getTime()}`
          });
          return success(proposalOut(updated[0]), "Revision requested", 200, requestId);
        }
        if (decision !== "shortlist" && decision !== "decline") return failure("INVALID_ACTION", "Action must be shortlist, decline or request_revision.", 422, requestId);
        const next = decision === "shortlist" ? "shortlisted" : "declined";
        const updated = await sql<ProposalRow[]>`
          UPDATE listing_proposals SET status = ${next}, decided_at = now(), updated_at = now()
          WHERE id = ${proposalId} AND status IN ('submitted', 'shortlisted')
          RETURNING *
        `;
        if (!updated[0]) return failure("PROPOSAL_CLOSED", "This proposal can no longer change.", 409, requestId);
        await notifyUsers(sql, [updated[0].freelancer_user_id], {
          kind: `proposal.${next}`,
          title: decision === "shortlist" ? "Your proposal was shortlisted" : "Your proposal was not selected",
          message: decision === "shortlist" ? "The client may send you an offer." : "Keep going — new projects are posted every day.",
          link: "/projects",
          dedupe: `proposal-decision:${updated[0].id}:${next}`
        });
        return success(proposalOut(updated[0]), decision === "shortlist" ? "Shortlisted" : "Declined", 200, requestId);
      }

      // action === "offer"
      if (!["published", "hiring", "paused"].includes(found.listing_status)) {
        return failure("LISTING_NOT_OPEN", "Offers can only be made on open listings.", 409, requestId);
      }
      const terms = validateTerms((payload.terms ?? {}) as Record<string, unknown>, found.listing_currency, deps.now());
      if (!terms.ok) return failure("INVALID_TERMS", "Check the highlighted fields.", 422, requestId, [terms.errors]);
      const hash = await termsHash(terms.value);
      const contractId = crypto.randomUUID();
      const result = await sql.begin(async (tx) => {
        const row = await proposalForUpdate(tx, proposalId);
        if (!row || !OPEN_PROPOSAL_STATUSES.includes(row.status)) return { code: "CLOSED" as const };
        await tx`
          INSERT INTO contracts (id, listing_id, proposal_id, organization_id, freelancer_user_id, status, current_version, created_by, created_at, updated_at)
          VALUES (${contractId}, ${row.listing_id}, ${row.id}, ${found.organization_id}, ${row.freelancer_user_id}, 'offered', 1, ${userId}, now(), now())
        `;
        await insertContractVersion(tx, contractId, 1, terms.value, hash, "client", userId);
        await tx`UPDATE listing_proposals SET status = 'offered', decided_at = now(), updated_at = now() WHERE id = ${row.id}`;
        await recordContractEvent(tx, contractId, userId, "client", "offer.sent", { version: 1, total_minor: terms.value.total_minor });
        return { code: "OK" as const };
      });
      if (result.code === "CLOSED") return failure("PROPOSAL_CLOSED", "This proposal can no longer receive an offer.", 409, requestId);
      return await respondWithContract(sql, contractId, userId, "Offer sent. The freelancer must accept the same terms.", 201, requestId);
    }

    /* ---------------- client: proposals for a listing ---------------- */
    if (listingProposals) {
      if (!roles.includes("client")) return failure("CLIENT_ROLE_REQUIRED", "Turn on the client (hiring) role first.", 403, requestId);
      const listing = (await sql<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${listingProposals[1]} LIMIT 1`)[0];
      const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
      if (!listing || !org) return failure("NOT_FOUND", "Listing not found", 404, requestId);
      const rows = await sql<(ProposalWithCard & { contract_id: string | null; contract_status: string | null })[]>`
        SELECT p.*, pr.full_name, pr.headline, pr.skills, pr.services, pr.minimum_budget, pr.hourly_rate,
               pr.currency AS profile_currency, pr.weekly_hours, pr.timezone, u.created_at AS user_created_at,
               c.id AS contract_id, c.status AS contract_status
        FROM listing_proposals p
        JOIN users u ON u.id = p.freelancer_user_id
        LEFT JOIN profiles pr ON pr.user_id = p.freelancer_user_id
        LEFT JOIN contracts c ON c.proposal_id = p.id AND c.status IN ('offered', 'active')
        WHERE p.listing_id = ${listing.id} AND p.status <> 'withdrawn'
        ORDER BY p.created_at DESC
        LIMIT 200
      `;
      const now = deps.now();
      return success(
        rows.map((r) => ({
          ...proposalOut(r),
          contract_id: r.contract_id,
          contract_status: r.contract_status,
          freelancer: freelancerCard(
            {
              user_id: r.freelancer_user_id, full_name: r.full_name ?? "", headline: r.headline ?? "", skills: r.skills ?? "[]",
              services: r.services ?? "[]", minimum_budget: r.minimum_budget, hourly_rate: r.hourly_rate,
              currency: r.profile_currency ?? "INR", weekly_hours: r.weekly_hours,
              timezone: r.timezone ?? "", dealbreakers: "[]", user_created_at: r.user_created_at
            },
            now
          )
        })),
        "Proposals",
        200,
        requestId
      );
    }

    /* ---------------- contracts ---------------- */
    if (contracts) {
      const rows = await sql<(ContractRow & ContractVersionRow & { organization_name: string; c_created_at: Date })[]>`
        SELECT c.id, c.listing_id, c.proposal_id, c.organization_id, c.freelancer_user_id, c.status, c.current_version,
               c.created_at AS c_created_at, c.updated_at, c.activated_at,
               v.version, v.title, v.scope, v.deliverables_json, v.milestones_json, v.total_minor, v.currency, v.revision_rounds,
               v.acceptance_json, v.ownership_terms, v.content_hash, v.proposed_by, v.created_at, v.client_accepted_at,
               v.freelancer_accepted_at, o.name AS organization_name
        FROM contracts c
        JOIN contract_versions v ON v.contract_id = c.id AND v.version = c.current_version
        JOIN organizations o ON o.id = c.organization_id
        WHERE c.freelancer_user_id = ${userId}
           OR EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = c.organization_id AND m.user_id = ${userId} AND m.status = 'active')
        ORDER BY c.updated_at DESC
        LIMIT 100
      `;
      return success(
        rows.map((r) => ({
          id: r.id,
          status: r.status,
          party: r.freelancer_user_id === userId ? "freelancer" : "client",
          client_name: r.organization_name,
          current_version: r.current_version,
          created_at: new Date(r.c_created_at).toISOString(),
          activated_at: r.activated_at ? new Date(r.activated_at).toISOString() : null,
          terms: contractVersionOut(r)
        })),
        "Contracts",
        200,
        requestId
      );
    }

    if (contract) {
      const contractId = contract[1];
      const action = contract[2];
      const row = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
      const side = row ? await partyOf(sql, userId, row) : null;
      if (!row || !side) return failure("NOT_FOUND", "Contract not found", 404, requestId);

      if (!action) return await respondWithContract(sql, contractId, userId, "Contract", 200, requestId);

      if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins can act on contracts.", 403, requestId);
      const payload = (await body(request)) ?? {};

      if (action === "decline" || action === "withdraw") {
        const allowed = action === "decline" ? side.party === "freelancer" : side.party === "client";
        if (!allowed) return failure("FORBIDDEN", action === "decline" ? "Only the freelancer can decline an offer." : "Only the client can withdraw an offer.", 403, requestId);
        const done = await sql.begin(async (tx) => {
          const updated = await tx<ContractRow[]>`
            UPDATE contracts SET status = ${action === "decline" ? "declined" : "withdrawn"}, updated_at = now()
            WHERE id = ${contractId} AND status = 'offered' RETURNING *
          `;
          if (!updated[0]) return false;
          // The proposal can receive a new offer.
          await tx`UPDATE listing_proposals SET status = 'shortlisted', updated_at = now() WHERE id = ${updated[0].proposal_id} AND status = 'offered'`;
          await recordContractEvent(tx, contractId, userId, side.party, action === "decline" ? "offer.declined" : "offer.withdrawn");
          return true;
        });
        if (!done) return failure("CONTRACT_CLOSED", "Only open offers can be declined or withdrawn.", 409, requestId);
        return await respondWithContract(sql, contractId, userId, action === "decline" ? "Offer declined" : "Offer withdrawn", 200, requestId);
      }

      if (action === "reject-change") {
        const done = await sql.begin(async (tx) => {
          const locked = (await tx<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} FOR UPDATE`)[0];
          if (!locked || !hasPendingChange(locked)) return false;
          await tx`UPDATE contracts SET current_version = ${locked.agreed_version!}, updated_at = now() WHERE id = ${contractId}`;
          await recordContractEvent(tx, contractId, userId, side.party, "change.rejected", { version: locked.current_version });
          return true;
        });
        if (!done) return failure("NO_PENDING_CHANGE", "There is no proposed change to reject.", 409, requestId);
        return await respondWithContract(sql, contractId, userId, "Change rejected. The agreed terms still apply.", 200, requestId);
      }

      if (action === "accept") {
        const version = Number(payload.version);
        const result = await sql.begin(async (tx) => {
          const locked = (await tx<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} FOR UPDATE`)[0];
          const changeOrder = locked ? hasPendingChange(locked) : false;
          if (locked && locked.status === "active" && !changeOrder) return { code: "NOTHING_PENDING" as const };
          if (!locked || (locked.status !== "offered" && !changeOrder)) return { code: "CLOSED" as const };
          if (version !== locked.current_version) return { code: "STALE" as const, current: locked.current_version };
          const current = await contractVersion(tx, locked);
          if (!current) return { code: "CLOSED" as const };
          const already = side.party === "client" ? current.client_accepted_at : current.freelancer_accepted_at;
          if (already) return { code: "ALREADY" as const };
          if (side.party === "client") {
            await tx`UPDATE contract_versions SET client_accepted_at = now(), client_accepted_by = ${userId} WHERE contract_id = ${contractId} AND version = ${version}`;
          } else {
            await tx`UPDATE contract_versions SET freelancer_accepted_at = now() WHERE contract_id = ${contractId} AND version = ${version}`;
          }
          const otherAccepted = side.party === "client" ? current.freelancer_accepted_at : current.client_accepted_at;
          await recordContractEvent(tx, contractId, userId, side.party, "terms.accepted", { version });
          if (!otherAccepted) {
            await tx`UPDATE contracts SET updated_at = now() WHERE id = ${contractId}`;
            return { code: "WAITING" as const };
          }
          if (changeOrder) {
            await tx`UPDATE contracts SET agreed_version = ${version}, updated_at = now() WHERE id = ${contractId}`;
            await recordContractEvent(tx, contractId, null, "system", "change.accepted", { version });
            return { code: "CHANGED" as const };
          }
          await tx`UPDATE contracts SET status = 'active', activated_at = now(), agreed_version = ${version}, updated_at = now() WHERE id = ${contractId}`;
          await tx`UPDATE listing_proposals SET status = 'hired', updated_at = now() WHERE id = ${locked.proposal_id}`;
          await tx`UPDATE project_listings SET status = 'hiring', updated_at = now() WHERE id = ${locked.listing_id} AND status IN ('published', 'paused')`;
          await recordContractEvent(tx, contractId, null, "system", "contract.activated", { version });
          return { code: "ACTIVE" as const };
        });
        if (result.code === "CLOSED") return failure("CONTRACT_CLOSED", "This offer is no longer open.", 409, requestId);
        if (result.code === "NOTHING_PENDING") return failure("NO_PENDING_CHANGE", "There are no new terms to accept. The agreed terms apply.", 409, requestId);
        if (result.code === "STALE") return failure("VERSION_CONFLICT", `The terms changed (now version ${result.current}). Review them before accepting.`, 409, requestId);
        if (result.code === "ALREADY") return failure("ALREADY_ACCEPTED", "You already accepted these terms.", 409, requestId);
        return await respondWithContract(
          sql, contractId, userId,
          result.code === "ACTIVE"
            ? "Both parties accepted. The contract is active."
            : result.code === "CHANGED"
              ? "Both parties accepted the change. The new terms now apply."
              : "Accepted. Waiting for the other party.",
          200, requestId
        );
      }

      // action === "versions": propose changed terms
      const baseVersion = Number(payload.base_version);
      const listingCurrency = (await sql<{ currency: string }[]>`
        SELECT v.currency FROM contract_versions v WHERE v.contract_id = ${contractId} AND v.version = 1 LIMIT 1
      `)[0]?.currency ?? "INR";
      const terms = validateTerms((payload.terms ?? {}) as Record<string, unknown>, listingCurrency, deps.now());
      if (!terms.ok) return failure("INVALID_TERMS", "Check the highlighted fields.", 422, requestId, [terms.errors]);
      const hash = await termsHash(terms.value);
      const result = await sql.begin(async (tx) => {
        const locked = (await tx<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} FOR UPDATE`)[0];
        if (!locked || (locked.status !== "offered" && locked.status !== "active")) return { code: "CLOSED" as const };
        if (baseVersion !== locked.current_version) return { code: "STALE" as const, current: locked.current_version };
        const current = await contractVersion(tx, locked);
        if (current && current.content_hash === hash) return { code: "UNCHANGED" as const };
        if (locked.status === "active") {
          const agreedRow = (await tx<ContractVersionRow[]>`
            SELECT * FROM contract_versions WHERE contract_id = ${contractId} AND version = ${locked.agreed_version ?? locked.current_version} LIMIT 1
          `)[0];
          const delivered = (await tx<{ milestone_index: number }[]>`
            SELECT DISTINCT milestone_index FROM milestone_submissions WHERE contract_id = ${contractId}
          `).map((r) => Number(r.milestone_index));
          const lockErrors = agreedRow ? lockedMilestoneErrors(contractVersionOut(agreedRow).milestones, terms.value.milestones, delivered) : {};
          if (Object.keys(lockErrors).length) return { code: "LOCKED" as const, errors: lockErrors };
        }
        // Version numbers only grow: a rejected change keeps its number in the history.
        const maxRow = (await tx<{ max: number | null }[]>`SELECT max(version)::int AS max FROM contract_versions WHERE contract_id = ${contractId}`)[0];
        const next = Math.max(locked.current_version, Number(maxRow?.max ?? 0)) + 1;
        await insertContractVersion(tx, contractId, next, terms.value, hash, side.party, userId);
        await tx`UPDATE contracts SET current_version = ${next}, updated_at = now() WHERE id = ${contractId}`;
        await recordContractEvent(tx, contractId, userId, side.party, locked.status === "active" ? "change.proposed" : "terms.proposed", {
          version: next,
          total_minor: terms.value.total_minor
        });
        return { code: "OK" as const };
      });
      if (result.code === "CLOSED") return failure("CONTRACT_CLOSED", "Terms can only change while the offer is open or the contract is active.", 409, requestId);
      if (result.code === "LOCKED") return failure("INVALID_TERMS", "Delivered milestones cannot be changed.", 422, requestId, [result.errors]);
      if (result.code === "STALE") return failure("VERSION_CONFLICT", `The terms changed (now version ${result.current}). Reload and try again.`, 409, requestId);
      if (result.code === "UNCHANGED") return failure("UNCHANGED", "These are the current terms. Accept them instead.", 409, requestId);
      return await respondWithContract(sql, contractId, userId, "New terms proposed. The other party must accept them.", 201, requestId);
    }

    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function respondWithContract(sql: Sql, contractId: string, userId: string, message: string, status: number, requestId: string): Promise<Response> {
  const row = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
  const side = row ? await partyOf(sql, userId, row) : null;
  const version = row ? await contractVersion(sql, row) : null;
  if (!row || !side || !version) return failure("NOT_FOUND", "Contract not found", 404, requestId);
  const history = await sql<ContractVersionRow[]>`
    SELECT * FROM contract_versions WHERE contract_id = ${contractId} ORDER BY version DESC LIMIT 50
  `;
  const header = (await sql<{ title: string; organization_name: string }[]>`
    SELECT v.title, o.name AS organization_name
    FROM project_listings l
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = ${row.listing_id} LIMIT 1
  `)[0];
  return success(
    {
      id: row.id,
      listing_id: row.listing_id,
      proposal_id: row.proposal_id,
      status: row.status,
      party: side.party,
      can_manage: side.canManage,
      client_name: header?.organization_name ?? "",
      project_title: header?.title ?? "",
      current_version: row.current_version,
      agreed_version: row.agreed_version ?? null,
      pending_change: hasPendingChange(row),
      activated_at: row.activated_at ? new Date(row.activated_at).toISOString() : null,
      completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      terms: contractVersionOut(version),
      // While a change is pending, the agreed (still binding) terms are shown separately.
      agreed_terms: hasPendingChange(row) ? (history.map((v) => contractVersionOut(v)).find((v) => v.version === row.agreed_version) ?? null) : null,
      versions: history.map((v) => contractVersionOut(v)),
      allowed_actions: contractActions(row, version, side.party, side.canManage),
      // Funding is not implemented; it stays unavailable regardless of flags until Phase 4 is approved and built.
      funding: { available: false, message: PAYMENTS_OFF }
    },
    message,
    status,
    requestId
  );
}
