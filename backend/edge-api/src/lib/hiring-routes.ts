import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import type { ListingRow, VersionRow } from "./listings";
import { freelancerCard } from "./matching";
import type { CandidateRow } from "./matching";
import {
  OPEN_PROPOSAL_STATUSES,
  contractActions,
  contractVersionOut,
  proposalOut,
  termsHash,
  validateProposal,
  validateTerms
} from "./contracts";
import type { ContractRow, ContractTerms, ContractVersionRow, Party, ProposalRow } from "./contracts";

/**
 * Hiring loop (Phase 3 batch 1):
 *
 * Freelancer
 *   POST /api/v1/marketplace/listings/{id}/proposals {cover_letter, price_minor, estimated_days}
 *   GET  /api/v1/me/proposals
 *   PUT  /api/v1/listing-proposals/{id}              edit while submitted/shortlisted
 *   POST /api/v1/listing-proposals/{id}/withdraw
 * Client (client role + membership; changes need owner/admin)
 *   GET  /api/v1/listings/{id}/proposals
 *   POST /api/v1/listing-proposals/{id}/status {action: shortlist|decline}
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

  const propose = path.match(/^\/api\/v1\/marketplace\/listings\/([\w-]{1,64})\/proposals$/);
  const meProposals = path === "/api/v1/me/proposals";
  const proposal = path.match(/^\/api\/v1\/listing-proposals\/([\w-]{1,64})(?:\/(withdraw|status|offer))?$/);
  const listingProposals = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/proposals$/);
  const contracts = path === "/api/v1/contracts";
  const contract = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})(?:\/(accept|versions|decline|withdraw))?$/);

  const known =
    (propose !== null && method === "POST") ||
    (meProposals && method === "GET") ||
    (proposal !== null && (proposal[2] ? method === "POST" : method === "PUT")) ||
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
      const validation = validateProposal((await body(request)) ?? {});
      if (!validation.ok) return failure("INVALID_PROPOSAL", "Check the highlighted fields.", 422, requestId, [validation.errors]);
      const input = validation.value;

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
      if (listing.status !== "published" || (listing.closes_at && new Date(listing.closes_at) <= deps.now())) {
        return failure("LISTING_NOT_OPEN", "This project is not taking proposals.", 409, requestId);
      }
      const inserted = await sql<ProposalRow[]>`
        INSERT INTO listing_proposals
          (id, listing_id, freelancer_user_id, invitation_id, status, cover_letter, price_minor, currency, budget_model,
           estimated_days, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${listing.id}, ${userId}, ${listing.invitation_id}, 'submitted', ${input.cover_letter},
                ${input.price_minor}, ${listing.currency}, ${listing.budget_model}, ${input.estimated_days}, now(), now())
        ON CONFLICT (listing_id, freelancer_user_id) DO NOTHING
        RETURNING *
      `;
      if (!inserted[0]) return failure("ALREADY_PROPOSED", "You already sent a proposal for this project. Edit it instead.", 409, requestId);
      if (listing.invitation_id) {
        await sql`UPDATE listing_invitations SET status = 'accepted', responded_at = COALESCE(responded_at, now()) WHERE id = ${listing.invitation_id} AND status = 'pending'`;
      }
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
      if (!action || action === "withdraw") {
        const payload = action ? {} : (await body(request)) ?? {};
        const validation = action ? null : validateProposal(payload);
        if (validation && !validation.ok) return failure("INVALID_PROPOSAL", "Check the highlighted fields.", 422, requestId, [validation.errors]);
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
          const input = validation!.ok ? validation!.value : null;
          const updated = await tx<ProposalRow[]>`
            UPDATE listing_proposals SET cover_letter = ${input!.cover_letter}, price_minor = ${input!.price_minor},
              estimated_days = ${input!.estimated_days}, updated_at = now()
            WHERE id = ${proposalId} RETURNING *
          `;
          return { code: "OK" as const, row: updated[0] };
        });
        if (result.code === "NOT_FOUND") return failure("NOT_FOUND", "Proposal not found", 404, requestId);
        if (result.code === "CLOSED") return failure("PROPOSAL_CLOSED", `This proposal is ${result.status} and can no longer change.`, 409, requestId);
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
        if (decision !== "shortlist" && decision !== "decline") return failure("INVALID_ACTION", "Action must be shortlist or decline.", 422, requestId);
        const next = decision === "shortlist" ? "shortlisted" : "declined";
        const updated = await sql<ProposalRow[]>`
          UPDATE listing_proposals SET status = ${next}, decided_at = now(), updated_at = now()
          WHERE id = ${proposalId} AND status IN ('submitted', 'shortlisted')
          RETURNING *
        `;
        if (!updated[0]) return failure("PROPOSAL_CLOSED", "This proposal can no longer change.", 409, requestId);
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
          return true;
        });
        if (!done) return failure("CONTRACT_CLOSED", "Only open offers can be declined or withdrawn.", 409, requestId);
        return await respondWithContract(sql, contractId, userId, action === "decline" ? "Offer declined" : "Offer withdrawn", 200, requestId);
      }

      if (action === "accept") {
        const version = Number(payload.version);
        const result = await sql.begin(async (tx) => {
          const locked = (await tx<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} FOR UPDATE`)[0];
          if (!locked || locked.status !== "offered") return { code: "CLOSED" as const };
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
          if (!otherAccepted) {
            await tx`UPDATE contracts SET updated_at = now() WHERE id = ${contractId}`;
            return { code: "WAITING" as const };
          }
          await tx`UPDATE contracts SET status = 'active', activated_at = now(), updated_at = now() WHERE id = ${contractId}`;
          await tx`UPDATE listing_proposals SET status = 'hired', updated_at = now() WHERE id = ${locked.proposal_id}`;
          await tx`UPDATE project_listings SET status = 'hiring', updated_at = now() WHERE id = ${locked.listing_id} AND status IN ('published', 'paused')`;
          return { code: "ACTIVE" as const };
        });
        if (result.code === "CLOSED") return failure("CONTRACT_CLOSED", "This offer is no longer open.", 409, requestId);
        if (result.code === "STALE") return failure("VERSION_CONFLICT", `The terms changed (now version ${result.current}). Review them before accepting.`, 409, requestId);
        if (result.code === "ALREADY") return failure("ALREADY_ACCEPTED", "You already accepted these terms.", 409, requestId);
        return await respondWithContract(
          sql, contractId, userId,
          result.code === "ACTIVE" ? "Both parties accepted. The contract is active." : "Accepted. Waiting for the other party.",
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
        if (!locked || locked.status !== "offered") return { code: "CLOSED" as const };
        if (baseVersion !== locked.current_version) return { code: "STALE" as const, current: locked.current_version };
        const current = await contractVersion(tx, locked);
        if (current && current.content_hash === hash) return { code: "UNCHANGED" as const };
        const next = locked.current_version + 1;
        await insertContractVersion(tx, contractId, next, terms.value, hash, side.party, userId);
        await tx`UPDATE contracts SET current_version = ${next}, updated_at = now() WHERE id = ${contractId}`;
        return { code: "OK" as const };
      });
      if (result.code === "CLOSED") return failure("CONTRACT_CLOSED", "Terms can only change while the offer is open.", 409, requestId);
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
      client_name: header?.organization_name ?? "",
      project_title: header?.title ?? "",
      current_version: row.current_version,
      activated_at: row.activated_at ? new Date(row.activated_at).toISOString() : null,
      terms: contractVersionOut(version),
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
