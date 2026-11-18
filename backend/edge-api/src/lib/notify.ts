import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";

/**
 * In-app notifications (agent P9, deterministic). Business actions call
 * `notifyUsers`; a notification failure never blocks or rolls back the action
 * (it runs in a savepoint when inside a transaction). `dedupe_key` makes the
 * same event notify each person once.
 *
 *   GET  /api/v1/notifications?unread=1        my latest 50 (older dashboard shape kept: title, message, status, created_at)
 *   GET  /api/v1/notifications/unread-count
 *   POST /api/v1/notifications/read {ids?: string[]}   mark some or all as read
 */

export interface NotificationInput {
  kind: string;
  title: string;
  message: string;
  link?: string;
  dedupe?: string;
}

export async function notifyUsers(sql: Queryable, userIds: Array<string | null | undefined>, n: NotificationInput): Promise<void> {
  const recipients = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
  if (!recipients.length) return;
  const write = async (q: Queryable) => {
    for (const userId of recipients) {
      await q`
        INSERT INTO notifications (id, user_id, title, message, channel, status, created_at, kind, link, dedupe_key)
        VALUES (${crypto.randomUUID()}, ${userId}, ${n.title.slice(0, 240)}, ${n.message.slice(0, 2000)}, 'in_app', 'sent', now(),
                ${n.kind.slice(0, 60)}, ${(n.link ?? "").slice(0, 300)}, ${n.dedupe ? `${n.dedupe}:${userId}`.slice(0, 200) : null})
        ON CONFLICT (dedupe_key) DO NOTHING
      `;
    }
  };
  try {
    const candidate = sql as { savepoint?: (cb: (tx: Queryable) => Promise<void>) => Promise<void> };
    if (typeof candidate.savepoint === "function") await candidate.savepoint(write);
    else await write(sql);
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "notify.failed", kind: n.kind, error: error instanceof Error ? error.message : "unknown" }));
  }
}

/** Owners and admins of a client organisation. */
export async function organizationManagers(sql: Queryable, organizationId: string): Promise<string[]> {
  try {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND role IN ('owner', 'admin') AND status = 'active'
    `;
    return rows.map((r) => r.user_id);
  } catch {
    return [];
  }
}

/** Plain-language text for contract events, sent to the other party. */
const CONTRACT_MESSAGES: Record<string, { title: string; to: "client" | "freelancer" | "both" }> = {
  "offer.sent": { title: "You received an offer", to: "freelancer" },
  "offer.declined": { title: "Your offer was declined", to: "client" },
  "offer.withdrawn": { title: "An offer to you was withdrawn", to: "freelancer" },
  "terms.proposed": { title: "New contract terms were proposed", to: "both" },
  "change.proposed": { title: "A change to your contract was proposed", to: "both" },
  "change.accepted": { title: "The contract change was accepted", to: "both" },
  "change.rejected": { title: "The proposed contract change was rejected", to: "both" },
  "contract.activated": { title: "Your contract is active", to: "both" },
  "milestone.submitted": { title: "Work was delivered for review", to: "client" },
  "milestone.approved": { title: "Your milestone was approved", to: "freelancer" },
  "milestone.revision_requested": { title: "A revision was requested", to: "freelancer" },
  "milestone.funded": { title: "A milestone was funded", to: "freelancer" },
  "milestone.released": { title: "Payment released to you", to: "freelancer" },
  "milestone.refunded": { title: "A milestone payment was refunded", to: "both" },
  "contract.completed": { title: "The contract is completed — leave a review", to: "both" },
  "cancellation.requested": { title: "Cancellation requested", to: "both" },
  "cancellation.declined": { title: "Cancellation declined", to: "both" },
  "contract.cancelled": { title: "The contract was cancelled", to: "both" },
  "review.submitted": { title: "You received a review", to: "both" },
  "dispute.opened": { title: "A dispute was opened on your contract", to: "both" },
  "dispute.statement_added": { title: "A new statement was added to the dispute", to: "both" },
  "dispute.withdrawn": { title: "The dispute was withdrawn", to: "both" },
  "dispute.resolved": { title: "Staff decided the dispute", to: "both" }
};

export async function notifyContractEvent(sql: Queryable, contractId: string, actorUserId: string | null, eventType: string, details: Record<string, unknown>, eventId: string): Promise<void> {
  const spec = CONTRACT_MESSAGES[eventType];
  if (!spec) return;
  // Inside a transaction, run in a savepoint so a failure cannot abort the business action.
  const candidate = sql as { savepoint?: (cb: (tx: Queryable) => Promise<void>) => Promise<void> };
  if (typeof candidate.savepoint === "function") {
    await candidate.savepoint((tx) => sendContractNotification(tx, contractId, actorUserId, eventType, details, eventId, spec)).catch((error: unknown) => {
      console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "notify.contract_failed", error: error instanceof Error ? error.message : "unknown" }));
    });
    return;
  }
  await sendContractNotification(sql, contractId, actorUserId, eventType, details, eventId, spec);
}

async function sendContractNotification(
  sql: Queryable,
  contractId: string,
  actorUserId: string | null,
  eventType: string,
  details: Record<string, unknown>,
  eventId: string,
  spec: { title: string; to: "client" | "freelancer" | "both" }
): Promise<void> {
  try {
    const contract = (await sql<{ freelancer_user_id: string; organization_id: string }[]>`
      SELECT freelancer_user_id, organization_id FROM contracts WHERE id = ${contractId} LIMIT 1
    `)[0];
    if (!contract) return;
    const recipients: string[] = [];
    if (spec.to !== "client") recipients.push(contract.freelancer_user_id);
    if (spec.to !== "freelancer") recipients.push(...(await organizationManagers(sql, contract.organization_id)));
    const title = typeof details.title === "string" && details.title ? `${spec.title}: ${details.title}` : spec.title;
    await notifyUsers(sql, recipients.filter((r) => r !== actorUserId), {
      kind: eventType,
      title,
      message: spec.title,
      link: `/contracts#${contractId}`,
      dedupe: `event:${eventId}`
    });
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "notify.contract_failed", error: error instanceof Error ? error.message : "unknown" }));
  }
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export interface NotifyRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: NotifyRouteDeps = { database, authenticate: authenticateRequest };

export async function handleNotificationRoute(request: Request, env: Env, requestId: string, deps: NotifyRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const known =
    (method === "GET" && (path === "/api/v1/notifications" || path === "/api/v1/notifications/unread-count")) ||
    (method === "POST" && path === "/api/v1/notifications/read");
  if (!known) return null;
  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    if (path === "/api/v1/notifications/unread-count") {
      const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
      return success({ unread: rows[0]?.n ?? 0 }, "Unread notifications", 200, requestId);
    }
    if (path === "/api/v1/notifications/read") {
      const payload = (await body(request)) ?? {};
      const ids = Array.isArray(payload.ids) ? payload.ids.filter((i): i is string => typeof i === "string" && /^[\w-]{1,64}$/.test(i)).slice(0, 200) : null;
      const rows = ids
        ? await sql<{ id: string }[]>`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL AND id = ANY(${textArray(ids)}::text[]) RETURNING id`
        : await sql<{ id: string }[]>`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL RETURNING id`;
      return success({ marked: rows.length }, "Marked as read", 200, requestId);
    }
    const unreadOnly = url.searchParams.get("unread") === "1";
    const rows = unreadOnly
      ? await sql<{ id: string; title: string; message: string; kind: string; link: string; read_at: Date | null; created_at: Date | null; status: string; channel: string }[]>`
          SELECT id, title, message, kind, link, read_at, created_at, status, channel FROM notifications
          WHERE user_id = ${userId} AND read_at IS NULL ORDER BY created_at DESC NULLS LAST LIMIT 50
        `
      : await sql<{ id: string; title: string; message: string; kind: string; link: string; read_at: Date | null; created_at: Date | null; status: string; channel: string }[]>`
          SELECT id, title, message, kind, link, read_at, created_at, status, channel FROM notifications
          WHERE user_id = ${userId} ORDER BY created_at DESC NULLS LAST LIMIT 50
        `;
    return success(
      rows.map((r) => ({
        id: r.id, title: r.title, message: r.message, kind: r.kind, link: r.link, channel: r.channel,
        status: r.read_at ? "read" : r.status, read: Boolean(r.read_at), created_at: r.created_at ? new Date(r.created_at).toISOString() : null
      })),
      "Notifications",
      200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
