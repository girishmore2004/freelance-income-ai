import type { Env } from "../types";
import { NOT_AVAILABLE, isBlocked } from "./fair-proposals";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { screenText } from "./listings";
import { notifyUsers, organizationManagers } from "./notify";
import { tableExists } from "./external-pipeline";

/**
 * Discussions and interviews before a contract (U9; Master Plan "Discuss",
 * spec §9–10), plus the unified inbox:
 *
 *   GET  /api/v1/listing-proposals/{id}/discussion          messages and interviews (freelancer or client member)
 *   POST /api/v1/listing-proposals/{id}/messages {body}     while the proposal is submitted or shortlisted
 *   POST /api/v1/listing-proposals/{id}/interviews {starts_at, duration_minutes, mode, meeting_link?, agenda?}
 *   POST /api/v1/proposal-interviews/{id}/respond {response: accept|decline}   the other side only
 *   POST /api/v1/proposal-interviews/{id}/cancel                               either side, before it starts
 *   POST /api/v1/proposal-interviews/{id}/complete {note?}                     client owner/admin, after it starts
 *   GET  /api/v1/inbox?q=                                   contract, proposal and external-reply threads
 *
 * Client side: any active member reads and messages; owners and admins
 * schedule and answer interviews. Contact and payment details are refused
 * (same screen as contract messages). Meeting links must be https on a known
 * meeting service. After an offer, the conversation continues on the contract.
 */

export interface DiscussionRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: DiscussionRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

const OPEN = ["submitted", "shortlisted"];
const MAX_MESSAGE = 4000;
const MAX_ACTIVE_INTERVIEWS = 3;
const MEETING_HOSTS = ["meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "whereby.com", "meet.jit.si"];

/** https links on a known meeting service only (subdomains of zoom.us allowed). */
export function meetingLinkOk(link: string): boolean {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export type InterviewInput = { starts_at: string; duration_minutes: number; mode: "video" | "phone" | "chat"; meeting_link: string; agenda: string };

export function validateInterview(input: Record<string, unknown>, now: Date): { ok: true; value: InterviewInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const raw = typeof input.starts_at === "string" ? input.starts_at : "";
  const start = new Date(raw);
  if (!raw || Number.isNaN(start.getTime())) errors.starts_at = "Choose a date and time.";
  else if (start.getTime() < now.getTime() + 30 * 60_000) errors.starts_at = "Choose a time at least 30 minutes from now.";
  else if (start.getTime() > now.getTime() + 90 * 86_400_000) errors.starts_at = "Choose a time within the next 90 days.";
  const duration = input.duration_minutes === undefined ? 30 : Number(input.duration_minutes);
  if (!Number.isInteger(duration) || duration < 15 || duration > 180) errors.duration_minutes = "Duration must be 15 to 180 minutes.";
  const mode = input.mode === undefined ? "video" : input.mode;
  if (mode !== "video" && mode !== "phone" && mode !== "chat") errors.mode = "Choose video, phone or chat.";
  const link = typeof input.meeting_link === "string" ? input.meeting_link.trim() : "";
  if (link && !meetingLinkOk(link)) errors.meeting_link = "Use an https link from Google Meet, Zoom, Microsoft Teams, Whereby or Jitsi.";
  const agenda = typeof input.agenda === "string" ? input.agenda.trim() : "";
  if (agenda.length > 1000) errors.agenda = "Keep the agenda under 1,000 characters.";
  else if (agenda && screenText(agenda).length) errors.agenda = "Keep contact and payment details out of the agenda.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { starts_at: start.toISOString(), duration_minutes: duration, mode: mode as InterviewInput["mode"], meeting_link: link, agenda } };
}

export type InterviewAction = "accept" | "decline" | "cancel" | "complete";

/** Who may do what to an interview, and when. */
export function interviewAllowed(
  action: InterviewAction,
  iv: { status: string; proposed_party: string; starts_at: Date | string },
  actor: { party: "client" | "freelancer"; canManage: boolean },
  now: Date
): { ok: true } | { ok: false; code: string; message: string } {
  const started = new Date(iv.starts_at).getTime() <= now.getTime();
  if (actor.party === "client" && !actor.canManage) return { ok: false, code: "FORBIDDEN", message: "Only owners and admins of the client account manage interviews." };
  if (action === "accept" || action === "decline") {
    if (iv.status !== "proposed") return { ok: false, code: "INTERVIEW_CLOSED", message: "This interview is no longer waiting for an answer." };
    if (iv.proposed_party === actor.party) return { ok: false, code: "FORBIDDEN", message: "The other side answers an interview you proposed." };
    if (started) return { ok: false, code: "INTERVIEW_PASSED", message: "This time has already passed. Propose a new one." };
    return { ok: true };
  }
  if (action === "cancel") {
    if (!["proposed", "accepted"].includes(iv.status)) return { ok: false, code: "INTERVIEW_CLOSED", message: "This interview is already closed." };
    if (started) return { ok: false, code: "INTERVIEW_PASSED", message: "This interview has started; record it as completed instead." };
    return { ok: true };
  }
  if (actor.party !== "client") return { ok: false, code: "FORBIDDEN", message: "The client records the interview as completed." };
  if (iv.status !== "accepted") return { ok: false, code: "INTERVIEW_CLOSED", message: "Only an accepted interview can be completed." };
  if (!started) return { ok: false, code: "INTERVIEW_NOT_STARTED", message: "Record it after the interview has started." };
  return { ok: true };
}

type ProposalAccess = {
  id: string; status: string; freelancer_user_id: string; organization_id: string; listing_id: string; title: string;
  party: "client" | "freelancer"; canManage: boolean;
};

async function proposalAccess(sql: Queryable, proposalId: string, userId: string): Promise<ProposalAccess | null> {
  const row = (await sql<Array<{ id: string; status: string; freelancer_user_id: string; organization_id: string; listing_id: string; title: string; membership_role: string | null }>>`
    SELECT p.id, p.status, p.freelancer_user_id, l.organization_id, p.listing_id, v.title,
           (SELECT m.role FROM organization_memberships m WHERE m.organization_id = l.organization_id AND m.user_id = ${userId} AND m.status = 'active' LIMIT 1) AS membership_role
    FROM listing_proposals p
    JOIN project_listings l ON l.id = p.listing_id
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    WHERE p.id = ${proposalId} LIMIT 1
  `)[0];
  if (!row) return null;
  if (row.freelancer_user_id === userId) return { ...row, party: "freelancer", canManage: true };
  if (row.membership_role && row.status !== "withdrawn") return { ...row, party: "client", canManage: ["owner", "admin"].includes(row.membership_role) };
  return null;
}

async function recipients(sql: Queryable, access: ProposalAccess): Promise<string[]> {
  return access.party === "client" ? [access.freelancer_user_id] : organizationManagers(sql, access.organization_id);
}

function interviewOut(r: Record<string, unknown>, party: string) {
  return {
    id: r.id, status: r.status, proposed_party: r.proposed_party, mine: r.proposed_party === party,
    starts_at: new Date(r.starts_at as string).toISOString(), duration_minutes: Number(r.duration_minutes), mode: r.mode,
    meeting_link: r.meeting_link, agenda: r.agenda, outcome_note: r.outcome_note,
    responded_at: r.responded_at ? new Date(r.responded_at as string).toISOString() : null
  };
}

export type InboxThread = {
  kind: "contract" | "proposal" | "external";
  id: string;
  title: string;
  last_message: string;
  last_at: string;
  from_other_side: boolean;
  /** Which of the user's roles the thread belongs to, so the app can show one side at a time. */
  side: "freelancer" | "client";
  href: string;
};

/** Newest first; "needs reply" = the last message came from the other side. Optional text filter. */
export function mergeThreads(groups: InboxThread[][], q: string): InboxThread[] {
  const needle = q.trim().toLowerCase();
  return groups
    .flat()
    .filter((t) => !needle || `${t.title} ${t.last_message}`.toLowerCase().includes(needle))
    .sort((a, b) => b.last_at.localeCompare(a.last_at))
    .slice(0, 100);
}

async function inbox(sql: Queryable, userId: string, q: string): Promise<InboxThread[]> {
  const iso = (v: unknown) => new Date(v as string).toISOString();
  const contracts = await sql<Array<{ contract_id: string; title: string; body: string; created_at: Date; sender_party: string; my_party: string }>>`
    SELECT DISTINCT ON (c.id) c.id AS contract_id, v.title, m.body, m.created_at, m.sender_party,
           CASE WHEN c.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS my_party
    FROM contracts c
    JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
    JOIN contract_messages m ON m.contract_id = c.id
    WHERE c.freelancer_user_id = ${userId}
       OR EXISTS (SELECT 1 FROM organization_memberships om WHERE om.organization_id = c.organization_id AND om.user_id = ${userId} AND om.status = 'active')
    ORDER BY c.id, m.created_at DESC
    LIMIT 200
  `;
  const proposals = (await tableExists(sql, "proposal_messages"))
    ? await sql<Array<{ proposal_id: string; title: string; body: string; created_at: Date; sender_party: string; my_party: string }>>`
        SELECT DISTINCT ON (p.id) p.id AS proposal_id, v.title, pm.body, pm.created_at, pm.sender_party,
               CASE WHEN p.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS my_party
        FROM listing_proposals p
        JOIN project_listings l ON l.id = p.listing_id
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        JOIN proposal_messages pm ON pm.proposal_id = p.id
        WHERE p.freelancer_user_id = ${userId}
           OR EXISTS (SELECT 1 FROM organization_memberships om WHERE om.organization_id = l.organization_id AND om.user_id = ${userId} AND om.status = 'active')
        ORDER BY p.id, pm.created_at DESC
        LIMIT 200
      `
    : [];
  const external = await sql<Array<{ opportunity_id: string; title: string; subject: string; body: string; received_at: Date; direction: string }>>`
    SELECT DISTINCT ON (a.id) a.opportunity_id, o.title, am.subject, am.body, am.received_at, am.direction
    FROM applications a
    JOIN opportunities o ON o.id = a.opportunity_id
    JOIN application_messages am ON am.application_id = a.id
    WHERE a.user_id = ${userId}
    ORDER BY a.id, am.received_at DESC
    LIMIT 200
  `.catch(() => []);
  return mergeThreads(
    [
      contracts.map((c) => ({ kind: "contract" as const, id: c.contract_id, title: c.title, last_message: c.body.slice(0, 200), last_at: iso(c.created_at), from_other_side: c.sender_party !== c.my_party, side: c.my_party === "client" ? ("client" as const) : ("freelancer" as const), href: `/contracts#${c.contract_id}` })),
      proposals.map((p) => ({ kind: "proposal" as const, id: p.proposal_id, title: p.title, last_message: p.body.slice(0, 200), last_at: iso(p.created_at), from_other_side: p.sender_party !== p.my_party, side: p.my_party === "client" ? ("client" as const) : ("freelancer" as const), href: `/inbox?proposal=${p.proposal_id}` })),
      external.map((e) => ({ kind: "external" as const, id: e.opportunity_id, title: e.title, last_message: (e.subject ? `${e.subject}: ` : "") + String(e.body ?? "").slice(0, 180), last_at: iso(e.received_at), from_other_side: e.direction === "in", side: "freelancer" as const, href: `/opportunities?id=${e.opportunity_id}` }))
    ],
    q
  );
}

export async function handleDiscussionRoute(request: Request, env: Env, requestId: string, deps: DiscussionRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const onProposal = path.match(/^\/api\/v1\/listing-proposals\/([\w-]{1,64})\/(discussion|messages|interviews)$/);
  const onInterview = path.match(/^\/api\/v1\/proposal-interviews\/([\w-]{1,64})\/(respond|cancel|complete)$/);
  const known =
    (path === "/api/v1/inbox" && method === "GET") ||
    (onProposal !== null && (onProposal[2] === "discussion" ? method === "GET" : method === "POST")) ||
    (onInterview !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  const now = deps.now();

  try {
    if (path === "/api/v1/inbox") {
      const q = (url.searchParams.get("q") ?? "").slice(0, 100);
      return success(await inbox(sql, userId, q), "Inbox", 200, requestId);
    }
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    if (!(await tableExists(sql, "proposal_messages"))) return failure("MIGRATION_PENDING", "Discussions need database migration 0070.", 503, requestId);

    if (onProposal) {
      const access = await proposalAccess(sql, onProposal[1], userId);
      if (!access) return failure("NOT_FOUND", "Proposal not found", 404, requestId);
      const action = onProposal[2];

      if (action === "discussion") {
        const [messages, interviews] = await Promise.all([
          sql<Array<Record<string, unknown>>>`SELECT id, sender_party, sender_user_id, body, created_at FROM proposal_messages WHERE proposal_id = ${access.id} ORDER BY created_at ASC LIMIT 500`,
          sql<Array<Record<string, unknown>>>`SELECT * FROM proposal_interviews WHERE proposal_id = ${access.id} ORDER BY starts_at ASC LIMIT 50`
        ]);
        return success(
          {
            party: access.party,
            can_message: OPEN.includes(access.status),
            can_schedule: OPEN.includes(access.status) && access.canManage,
            proposal_status: access.status,
            messages: messages.map((m) => ({ id: m.id, from: m.sender_party, mine: m.sender_user_id === userId, body: m.body, created_at: new Date(m.created_at as string).toISOString() })),
            interviews: interviews.map((i) => interviewOut(i, access.party)),
            note: OPEN.includes(access.status) ? "" : "After an offer, continue the conversation on the contract."
          },
          "Discussion",
          200,
          requestId
        );
      }

      if (!OPEN.includes(access.status)) return failure("DISCUSSION_CLOSED", "Discussion is open while the proposal is submitted or shortlisted. After an offer, use the contract messages.", 409, requestId);
      const payload = (await body(request)) ?? {};
      if (await isBlocked(sql, access.freelancer_user_id, access.organization_id)) return failure("NOT_AVAILABLE", NOT_AVAILABLE, 403, requestId);

      if (action === "messages") {
        const text = typeof payload.body === "string" ? payload.body.trim() : "";
        if (!text) return failure("EMPTY_MESSAGE", "Write a message first.", 422, requestId);
        if (text.length > MAX_MESSAGE) return failure("MESSAGE_TOO_LONG", `Keep messages under ${MAX_MESSAGE} characters.`, 422, requestId);
        const findings = screenText(text);
        if (findings.length) {
          return failure("MESSAGE_NOT_ALLOWED", "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests.", 422, requestId, [{ codes: findings.map((f) => f.code) }]);
        }
        const id = crypto.randomUUID();
        await sql`INSERT INTO proposal_messages (id, proposal_id, sender_user_id, sender_party, body, created_at) VALUES (${id}, ${access.id}, ${userId}, ${access.party}, ${text}, now())`;
        await notifyUsers(sql, await recipients(sql, access), {
          kind: "proposal.message",
          title: `New message about "${access.title}"`,
          message: text.slice(0, 200),
          link: `/inbox?proposal=${access.id}`,
          dedupe: `proposal-message:${id}`
        });
        return success({ id, from: access.party, mine: true, body: text }, "Message sent", 201, requestId);
      }

      // interviews
      if (!access.canManage) return failure("FORBIDDEN", "Only owners and admins of the client account schedule interviews.", 403, requestId);
      const v = validateInterview(payload, now);
      if (!v.ok) return failure("INVALID_INTERVIEW", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const active = (await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM proposal_interviews WHERE proposal_id = ${access.id} AND status IN ('proposed', 'accepted') AND starts_at > now()
      `)[0]?.n ?? 0;
      if (active >= MAX_ACTIVE_INTERVIEWS) return failure("LIMIT_REACHED", "There are already 3 upcoming interview times. Cancel one first.", 409, requestId);
      const rows = await sql<Array<Record<string, unknown>>>`
        INSERT INTO proposal_interviews (id, proposal_id, proposed_by, proposed_party, starts_at, duration_minutes, mode, meeting_link, agenda, status, created_at)
        VALUES (${crypto.randomUUID()}, ${access.id}, ${userId}, ${access.party}, ${v.value.starts_at}, ${v.value.duration_minutes}, ${v.value.mode},
                ${v.value.meeting_link}, ${v.value.agenda}, 'proposed', now())
        RETURNING *
      `;
      await notifyUsers(sql, await recipients(sql, access), {
        kind: "interview.proposed",
        title: `Interview proposed for "${access.title}"`,
        message: `${new Date(v.value.starts_at).toUTCString()} (${v.value.duration_minutes} min, ${v.value.mode}). Accept or decline it.`,
        link: `/inbox?proposal=${access.id}`,
        dedupe: `interview:${rows[0].id}:proposed`
      });
      return success(interviewOut(rows[0], access.party), "Interview proposed", 201, requestId);
    }

    // interview actions
    const action = onInterview![2] as "respond" | "cancel" | "complete";
    const iv = (await sql<Array<Record<string, unknown>>>`SELECT * FROM proposal_interviews WHERE id = ${onInterview![1]} LIMIT 1`)[0];
    if (!iv) return failure("NOT_FOUND", "Interview not found", 404, requestId);
    const access = await proposalAccess(sql, String(iv.proposal_id), userId);
    if (!access) return failure("NOT_FOUND", "Interview not found", 404, requestId);
    const payload = (await body(request)) ?? {};
    const step: InterviewAction = action === "respond" ? (payload.response === "accept" ? "accept" : payload.response === "decline" ? "decline" : ("" as InterviewAction)) : action;
    if (!step) return failure("INVALID_RESPONSE", "Response must be accept or decline.", 422, requestId);
    const allowed = interviewAllowed(step, { status: String(iv.status), proposed_party: String(iv.proposed_party), starts_at: iv.starts_at as string }, access, now);
    if (!allowed.ok) return failure(allowed.code, allowed.message, allowed.code === "FORBIDDEN" ? 403 : 409, requestId);
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2000) : "";
    if (step === "complete" && note && screenText(note).length) return failure("INVALID_NOTE", "Keep contact and payment details out of the note.", 422, requestId);
    const next = { accept: "accepted", decline: "declined", cancel: "cancelled", complete: "completed" }[step];
    const rows = await sql<Array<Record<string, unknown>>>`
      UPDATE proposal_interviews SET status = ${next}, responded_by = ${userId}, responded_at = now(),
             outcome_note = CASE WHEN ${step} = 'complete' THEN ${note} ELSE outcome_note END
      WHERE id = ${iv.id as string} AND status = ${iv.status as string}
      RETURNING *
    `;
    if (!rows[0]) return failure("INTERVIEW_CLOSED", "This interview changed meanwhile. Reload and try again.", 409, requestId);
    if (step !== "complete") {
      await notifyUsers(sql, await recipients(sql, access), {
        kind: `interview.${next}`,
        title: `Interview ${next} for "${access.title}"`,
        message: new Date(iv.starts_at as string).toUTCString(),
        link: `/inbox?proposal=${access.id}`,
        dedupe: `interview:${iv.id as string}:${next}`
      });
    }
    return success(interviewOut(rows[0], access.party), `Interview ${next}`, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
