import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, organizationForMember } from "./identity";
import { screenText } from "./listings";
import type { ContractRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";

/**
 * Two-way reviews after a contract is completed (Phase 3 batch 3):
 *
 *   GET  /api/v1/contracts/{id}/reviews                  my review + the other party's (once revealed)
 *   POST /api/v1/contracts/{id}/review {rating, comment}  one per party, within 30 days of completion
 *
 * Reviews are revealed when both parties reviewed or 14 days after
 * completion, so neither side can see the other's review before writing its
 * own. Client reviews of a freelancer feed the rating on freelancer cards.
 */

export interface ReviewRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: ReviewRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

export const REVIEW_WINDOW_DAYS = 30;
export const REVEAL_AFTER_DAYS = 14;
const DAY = 86_400_000;

interface ReviewRow {
  reviewer_party: Party;
  rating: number;
  comment: string;
  created_at: Date;
}

/** Pure: whether reviews of a completed contract are visible to both parties. */
export function reviewsRevealed(completedAt: Date | null, reviews: Array<{ reviewer_party: string }>, now: Date): boolean {
  const parties = new Set(reviews.map((r) => r.reviewer_party));
  if (parties.has("client") && parties.has("freelancer")) return true;
  return completedAt !== null && now.getTime() - new Date(completedAt).getTime() >= REVEAL_AFTER_DAYS * DAY;
}

export function validateReview(input: Record<string, unknown>): { ok: true; rating: number; comment: string } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const rating = input.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Choose a rating from 1 to 5.";
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment.length > 2000) errors.comment = "Keep the review under 2,000 characters.";
  else if (screenText(comment).length) errors.comment = "Reviews cannot include contact details or payment requests.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, rating: rating as number, comment };
}

async function sideOf(sql: Queryable, userId: string, contract: ContractRow): Promise<{ party: Party; canManage: boolean } | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  return org ? { party: "client", canManage: canManageOrganization(org.membership_role) } : null;
}

export async function handleReviewRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: ReviewRouteDeps = defaultDeps
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const list = url.pathname.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/reviews$/);
  const write = url.pathname.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/review$/);
  if (!((list && method === "GET") || (write && method === "POST"))) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
      return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    }
    const contractId = (list ?? write)![1];
    const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
    const side = contract ? await sideOf(sql, userId, contract) : null;
    if (!contract || !side) return failure("NOT_FOUND", "Contract not found", 404, requestId);
    const now = deps.now();
    const completedAt = contract.completed_at ? new Date(contract.completed_at) : null;

    if (write) {
      if (contract.status !== "completed" || !completedAt) return failure("NOT_COMPLETED", "Reviews open when the contract is completed.", 409, requestId);
      if (now.getTime() - completedAt.getTime() > REVIEW_WINDOW_DAYS * DAY) {
        return failure("REVIEW_WINDOW_CLOSED", `Reviews can be written within ${REVIEW_WINDOW_DAYS} days of completion.`, 409, requestId);
      }
      if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins can review for the client.", 403, requestId);
      const validation = validateReview((await body(request)) ?? {});
      if (!validation.ok) return failure("INVALID_REVIEW", "Check the highlighted fields.", 422, requestId, [validation.errors]);
      const inserted = await sql.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          INSERT INTO contract_reviews (id, contract_id, reviewer_party, reviewer_user_id, rating, comment, created_at)
          VALUES (${crypto.randomUUID()}, ${contract.id}, ${side.party}, ${userId}, ${validation.rating}, ${validation.comment}, now())
          ON CONFLICT (contract_id, reviewer_party) DO NOTHING
          RETURNING id
        `;
        if (rows[0]) await recordContractEvent(tx, contract.id, userId, side.party, "review.submitted", { rating: validation.rating });
        return Boolean(rows[0]);
      });
      if (!inserted) return failure("ALREADY_REVIEWED", "You already reviewed this contract.", 409, requestId);
    }

    const reviews = await sql<ReviewRow[]>`
      SELECT reviewer_party, rating, comment, created_at FROM contract_reviews WHERE contract_id = ${contract.id}
    `;
    const revealed = reviewsRevealed(completedAt, reviews, now);
    const out = (r: ReviewRow | undefined) => (r ? { party: r.reviewer_party, rating: r.rating, comment: r.comment, created_at: new Date(r.created_at).toISOString() } : null);
    const mine = reviews.find((r) => r.reviewer_party === side.party);
    const theirs = reviews.find((r) => r.reviewer_party !== side.party);
    const windowOpen = contract.status === "completed" && completedAt !== null && now.getTime() - completedAt.getTime() <= REVIEW_WINDOW_DAYS * DAY;
    return success(
      {
        contract_id: contract.id,
        party: side.party,
        can_review: windowOpen && !mine && side.canManage,
        revealed,
        mine: out(mine),
        theirs: revealed ? out(theirs) : null,
        theirs_submitted: Boolean(theirs)
      },
      write ? (revealed ? "Review published" : "Review saved. It will be shown when the other party reviews, or after 14 days.") : "Reviews",
      write ? 201 : 200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
