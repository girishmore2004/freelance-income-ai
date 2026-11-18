import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles } from "./identity";
import { notifyUsers } from "./notify";
import { normalizeEmail } from "./team-routes";

/**
 * Support tickets (U7; spec §2 Contact and §14 Support Tickets):
 *
 *   POST /api/v1/support/tickets {topic, subject, body, email?, name?, website?}
 *        Visitors give an email; signed-in users are linked to their account.
 *        `website` is a hidden honeypot field: filled in → accepted silently, not stored.
 *   GET  /api/v1/me/support/tickets                       the caller's own tickets
 *   GET  /api/v1/admin/support/tickets?status=open|resolved   staff (admin, moderator)
 *   POST /api/v1/admin/support/tickets/{id}/resolve {note}    staff; the note reaches a signed-in sender
 *
 * Replies by email wait for an email provider (D-15); until then staff answer
 * signed-in users in-app and visitors from their own mailbox.
 */

export interface SupportRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: SupportRouteDeps = { database, authenticate: authenticateRequest };

export const SUPPORT_TOPICS = ["account", "payments", "project", "safety", "business", "other"] as const;
const MAX_OPEN_PER_SENDER = 5;

export interface TicketInput {
  topic: string;
  subject: string;
  body: string;
  email: string;
  name: string;
}

/** Validates a ticket. Visitors must give a valid email; signed-in users may leave it empty. */
export function validateTicket(input: Record<string, unknown>, signedIn: boolean): { ok: true; value: TicketInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const topic = text(input.topic);
  const subject = text(input.subject);
  const message = text(input.body);
  const name = text(input.name);
  const rawEmail = text(input.email);
  if (!SUPPORT_TOPICS.includes(topic as (typeof SUPPORT_TOPICS)[number])) errors.topic = "Choose what your message is about.";
  if (subject.length < 3 || subject.length > 160) errors.subject = "Subject must be 3 to 160 characters.";
  if (message.length < 20 || message.length > 5000) errors.body = "Write 20 to 5,000 characters so staff can help.";
  if (name.length > 120) errors.name = "Keep your name under 120 characters.";
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) errors.email = "Enter a valid email address.";
  if (!signedIn && !email) errors.email = "Enter the email address we should reply to.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { topic, subject, body: message, email: email ?? "", name } };
}

type TicketRow = {
  id: string; user_id: string | null; email: string; name: string; topic: string; subject: string; body: string; status: string;
  resolution_note: string; resolved_at: Date | null; created_at: Date;
};

function ticketOut(t: TicketRow, staff: boolean) {
  return {
    id: t.id,
    topic: t.topic,
    subject: t.subject,
    body: t.body,
    status: t.status,
    resolution_note: t.resolution_note,
    resolved_at: t.resolved_at ? new Date(t.resolved_at).toISOString() : null,
    created_at: new Date(t.created_at).toISOString(),
    ...(staff ? { email: t.email, name: t.name, user_id: t.user_id, signed_in: t.user_id !== null } : {})
  };
}

async function logAction(sql: Queryable, actor: string, targetId: string, note: string): Promise<void> {
  await sql`
    INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
    VALUES (${crypto.randomUUID()}, ${actor}, 'support_ticket', ${targetId}, 'support.resolved', ${note.slice(0, 2000)}, now())
  `;
}

export async function handleSupportRoute(request: Request, env: Env, requestId: string, deps: SupportRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const resolve = path.match(/^\/api\/v1\/admin\/support\/tickets\/([\w-]{1,64})\/resolve$/);
  const known =
    (path === "/api/v1/support/tickets" && method === "POST") ||
    (path === "/api/v1/me/support/tickets" && method === "GET") ||
    (path === "/api/v1/admin/support/tickets" && method === "GET") ||
    (resolve !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  const session = auth instanceof Response ? null : auth;
  if (path !== "/api/v1/support/tickets" && !session) return auth as Response;
  const sql = deps.database(env);

  try {
    if (path === "/api/v1/support/tickets") {
      const payload = (await body(request)) ?? {};
      if (typeof payload.website === "string" && payload.website.trim()) {
        // Honeypot: bots fill every field. Answer like a success, store nothing.
        return success({ received: true }, "Thank you. Staff will reply as soon as they can.", 201, requestId);
      }
      const v = validateTicket(payload, session !== null);
      if (!v.ok) return failure("INVALID_TICKET", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const t = v.value;
      const userId = session?.user.id ?? null;
      const email = t.email || session?.user.email || "";
      const open = (await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM support_tickets
        WHERE status = 'open' AND ((${userId}::text IS NOT NULL AND user_id = ${userId}) OR (${email} <> '' AND lower(email) = ${email.toLowerCase()}))
      `)[0]?.n ?? 0;
      if (open >= MAX_OPEN_PER_SENDER) return failure("LIMIT_REACHED", "You already have several open messages. Staff will answer those first.", 429, requestId);
      const rows = await sql<TicketRow[]>`
        INSERT INTO support_tickets (id, user_id, email, name, topic, subject, body, status, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${email}, ${t.name}, ${t.topic}, ${t.subject}, ${t.body}, 'open', now())
        RETURNING *
      `;
      console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "support.ticket_created", alert: true, topic: t.topic, signed_in: userId !== null }));
      return success({ received: true, id: rows[0].id }, "Thank you. Staff will reply as soon as they can.", 201, requestId);
    }

    const userId = session!.user.id;
    if (path === "/api/v1/me/support/tickets") {
      const rows = await sql<TicketRow[]>`SELECT * FROM support_tickets WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`;
      return success(rows.map((r) => ticketOut(r, false)), "Your messages", 200, requestId);
    }

    const roles = await loadRoles(sql, userId);
    if (!roles.includes("admin") && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (path === "/api/v1/admin/support/tickets") {
      const status = url.searchParams.get("status") === "resolved" ? "resolved" : "open";
      const rows = await sql<TicketRow[]>`
        SELECT * FROM support_tickets WHERE status = ${status}
        ORDER BY CASE WHEN ${status} = 'open' THEN created_at END ASC, created_at DESC LIMIT 100
      `;
      return success(rows.map((r) => ticketOut(r, true)), "Support tickets", 200, requestId);
    }

    const payload = (await body(request)) ?? {};
    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    if (note.length < 5 || note.length > 2000) return failure("NOTE_REQUIRED", "Write what was done or the answer (5 to 2,000 characters).", 422, requestId);
    const resolved = await sql.begin(async (tx) => {
      const rows = await tx<TicketRow[]>`
        UPDATE support_tickets SET status = 'resolved', resolution_note = ${note}, resolved_by = ${userId}, resolved_at = now()
        WHERE id = ${resolve![1]} AND status = 'open' RETURNING *
      `;
      if (rows[0]) await logAction(tx, userId, rows[0].id, note);
      return rows[0] ?? null;
    });
    if (!resolved) return failure("TICKET_CLOSED", "This ticket is not open.", 409, requestId);
    await notifyUsers(sql, [resolved.user_id], {
      kind: "support.resolved",
      title: `Support answered: ${resolved.subject}`,
      message: note.slice(0, 500),
      link: "/help",
      dedupe: `support:${resolved.id}`
    });
    return success(ticketOut(resolved, true), resolved.user_id ? "Resolved. The person sees your answer in their notifications." : "Resolved. Reply to the visitor from your mailbox (email sending is not set up yet).", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
