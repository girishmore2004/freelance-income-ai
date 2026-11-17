import type { Env } from "../types";
import { body, database, iso, requireUser, text } from "./core-routes";
import type { Row } from "./core-routes";
import {
  DAILY_APPLICATION_CAP,
  connectGmail,
  findContactEmail,
  freelancerBid,
  gmailAuthUrl,
  gmailConfigurationProblem,
  gmailSend,
  googleConfigured,
  makeState,
  readState,
  syncReplies
} from "./apply-agent";
import { failure, success } from "./response";

function messageOut(m: Row) {
  return {
    id: m.id,
    direction: m.direction,
    sender: m.sender,
    subject: m.subject,
    body: m.body,
    received_at: iso(m.received_at),
    ai_label: m.ai_label,
    ai_summary: m.ai_summary,
    ai_suggestion: m.ai_suggestion
  };
}

export async function handleApplyRoute(request: Request, env: Env, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const sendMatch = path.match(/^\/api\/v1\/proposals\/([\w-]{1,64})\/send$/);
  const replyMatch = path.match(/^\/api\/v1\/applications\/([\w-]{1,64})\/reply$/);
  const isCallback = path === "/api/v1/integrations/gmail/callback";

  const known =
    isCallback ||
    path === "/api/v1/integrations/status" ||
    path === "/api/v1/integrations/gmail/connect" ||
    path === "/api/v1/integrations/gmail/disconnect" ||
    path === "/api/v1/applications" ||
    path === "/api/v1/applications/sync" ||
    sendMatch !== null ||
    replyMatch !== null;
  if (!known) return null;

  const frontend = String(env.CORS_ORIGINS ?? "").split(",")[0].trim() || "/";
  const redirectUri = `${url.origin}/api/v1/integrations/gmail/callback`;

  // Google redirects the browser here, so there is no Authorization header.
  if (isCallback) {
    const sql = database(env);
    try {
      const userId = await readState(env, url.searchParams.get("state") ?? "");
      const code = url.searchParams.get("code");
      if (!userId || !code) return Response.redirect(`${frontend}/?gmail=failed`, 302);
      await connectGmail(env, sql, userId, code, redirectUri);
      return Response.redirect(`${frontend}/?gmail=connected`, 302);
    } catch (error) {
      console.error(JSON.stringify({ event: "gmail.connect_failed", error_message: error instanceof Error ? error.message : "unknown" }));
      return Response.redirect(`${frontend}/?gmail=failed`, 302);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  const user = await requireUser(request, env, requestId);
  if (user instanceof Response) return user;
  const userId = user;
  const sql = database(env);

  try {
    if (path === "/api/v1/integrations/status" && method === "GET") {
      const g = await sql`SELECT email FROM integrations WHERE user_id = ${userId} AND provider = 'gmail'`;
      return success(
        {
          gmail: { configured: googleConfigured(env), connected: g.length > 0, email: g[0]?.email ?? null },
          freelancer: { connected: Boolean(env.FREELANCER_TOKEN) },
          daily_cap: DAILY_APPLICATION_CAP
        },
        "Integrations",
        200,
        requestId
      );
    }

    if (path === "/api/v1/integrations/gmail/connect" && method === "GET") {
      const problem = gmailConfigurationProblem(env);
      if (problem) return failure("GMAIL_NOT_CONFIGURED", problem, 503, requestId);
      return success({ url: gmailAuthUrl(env, redirectUri, await makeState(env, userId)) }, "Open this link", 200, requestId);
    }

    if (path === "/api/v1/integrations/gmail/disconnect" && method === "POST") {
      await sql`DELETE FROM integrations WHERE user_id = ${userId} AND provider = 'gmail'`;
      return success({ disconnected: true }, "Gmail disconnected", 200, requestId);
    }

    // ---- send an APPROVED proposal ------------------------------------
    if (sendMatch && method === "POST") {
      const payload = (await body(request)) ?? {};
      const props = await sql`SELECT * FROM proposals WHERE id = ${sendMatch[1]} AND user_id = ${userId}`;
      const proposal = props[0];
      if (!proposal) return failure("NOT_FOUND", "Proposal not found", 404, requestId);
      if (proposal.status !== "approved") {
        return failure("NOT_APPROVED", "Approve this proposal first. The agent only sends approved proposals.", 409, requestId);
      }

      const dup = await sql`SELECT 1 FROM applications WHERE proposal_id = ${proposal.id} AND status IN ('sending','sent','replied') LIMIT 1`;
      if (dup.length) return failure("ALREADY_SENT", "This proposal was already sent.", 409, requestId);

      const today = await sql`SELECT count(*) AS c FROM applications WHERE user_id = ${userId} AND created_at > now() - interval '24 hours' AND status <> 'failed'`;
      if (Number(today[0].c) >= DAILY_APPLICATION_CAP) {
        return failure("DAILY_LIMIT", `Daily limit of ${DAILY_APPLICATION_CAP} applications reached. This protects your reputation.`, 429, requestId);
      }

      const opps = await sql`SELECT * FROM opportunities WHERE id = ${proposal.opportunity_id} AND user_id = ${userId}`;
      const opp = opps[0];
      if (!opp) return failure("NOT_FOUND", "Opportunity not found", 404, requestId);

      // 1. Decide the channel without any external side effect.
      let channel: "freelancer" | "email" | "manual" = "manual";
      let recipient = "";
      let price = 0;
      let days = 7;
      if (opp.source === "freelancer" && env.FREELANCER_TOKEN) {
        price =
          Number(payload.price) ||
          Number(proposal.proposed_price) ||
          (opp.budget_min && opp.budget_max ? (Number(opp.budget_min) + Number(opp.budget_max)) / 2 : 0);
        if (!price) {
          return failure("PRICE_REQUIRED", "Set a price on the proposal first. Freelancer.com bids need an amount.", 422, requestId);
        }
        days = Math.min(Math.max(Number(payload.days) || 7, 1), 90);
        channel = "freelancer";
      } else {
        const to = text(payload.to, 320) || findContactEmail(`${opp.description}\n${opp.title}`) || "";
        const hasGmail = (await sql`SELECT 1 FROM integrations WHERE user_id = ${userId} AND provider = 'gmail'`).length > 0;
        if (to && hasGmail) {
          channel = "email";
          recipient = to;
        }
      }

      if (channel === "manual") {
        const reason =
          opp.source === "freelancer"
            ? "Freelancer.com is not connected (FREELANCER_TOKEN missing)."
            : "This lead has no contact email or Gmail is not connected. Apply on the original page.";
        return success({ channel: "manual", url: opp.source_url, reason, proposal: proposal.content }, "Manual apply needed", 200, requestId);
      }

      // 2. Reserve the send. The partial unique index uq_applications_live_proposal
      //    (migration 0047) guarantees one live send per proposal, so a double
      //    click or a retried request cannot send twice.
      const applicationId = crypto.randomUUID();
      try {
        await sql`
          INSERT INTO applications (id, user_id, opportunity_id, proposal_id, channel, status, recipient, extra, created_at)
          VALUES (${applicationId}, ${userId}, ${opp.id}, ${proposal.id}, ${channel}, 'sending', ${recipient}, '{}', now())
        `;
      } catch (error) {
        if ((error as { code?: string } | null)?.code === "23505") {
          return failure("ALREADY_SENT", "This proposal is already being sent or was sent.", 409, requestId);
        }
        throw error;
      }

      // 3. Perform the external send, then record the outcome.
      let threadId = "";
      let externalRef = "";
      let extra: Record<string, unknown> = {};
      try {
        if (channel === "freelancer") {
          const sent = await freelancerBid(env, String(opp.external_id), price, days, String(proposal.content));
          externalRef = sent.bidId;
          extra = { project_id: String(opp.external_id), bidder_id: sent.bidderId };
        } else {
          const sent = await gmailSend(env, sql, userId, recipient, `Proposal: ${String(opp.title).slice(0, 150)}`, String(proposal.content));
          threadId = sent.threadId;
          externalRef = sent.id;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sending failed";
        await sql`
          UPDATE applications SET status = 'failed', extra = ${JSON.stringify({ error: message.slice(0, 300) })}
          WHERE id = ${applicationId}
        `;
        return failure("SEND_FAILED", message, 502, requestId);
      }

      await sql`
        UPDATE applications SET status = 'sent', external_ref = ${externalRef}, thread_id = ${threadId},
          extra = ${JSON.stringify(extra)}, sent_at = now()
        WHERE id = ${applicationId}
      `;
      await sql`UPDATE proposals SET status = 'sent' WHERE id = ${proposal.id} AND user_id = ${userId}`;
      await sql`UPDATE opportunities SET status = 'applied' WHERE id = ${opp.id} AND user_id = ${userId}`;
      await sql`
        INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'apply_agent', 'completed',
                ${`Sent via ${channel}${recipient ? " to " + recipient : ""}: "${String(opp.title).slice(0, 80)}"`}, now())
      `;
      return success({ channel, recipient, application_id: applicationId }, `Sent via ${channel}`, 200, requestId);
    }

    // ---- list applications with replies --------------------------------
    if (path === "/api/v1/applications" && method === "GET") {
      const apps = await sql`
        SELECT a.*, o.title, o.client_name, o.source_url FROM applications a
        JOIN opportunities o ON o.id = a.opportunity_id
        WHERE a.user_id = ${userId} ORDER BY a.created_at DESC LIMIT 100
      `;
      const msgs = await sql`
        SELECT * FROM application_messages WHERE user_id = ${userId} ORDER BY received_at ASC LIMIT 1000
      `;
      return success(
        apps.map((a) => ({
          id: a.id,
          opportunity_id: a.opportunity_id,
          title: a.title,
          client_name: a.client_name,
          source_url: a.source_url,
          channel: a.channel,
          status: a.status,
          recipient: a.recipient,
          sent_at: iso(a.sent_at),
          last_checked_at: iso(a.last_checked_at),
          messages: msgs.filter((m) => m.application_id === a.id).map(messageOut)
        })),
        "Applications",
        200,
        requestId
      );
    }

    if (path === "/api/v1/applications/sync" && method === "POST") {
      const result = await syncReplies(env, sql, userId);
      const note = result.new_messages
        ? `${result.new_messages} new repl${result.new_messages === 1 ? "y" : "ies"}`
        : result.errors.length
          ? `Checked, but some failed: ${result.errors[0]}`
          : "No new replies yet";
      return success(result, note, 200, requestId);
    }

    // ---- send a reply the user approved (tap) --------------------------
    if (replyMatch && method === "POST") {
      const payload = (await body(request)) ?? {};
      const content = text(payload.body, 6000);
      if (content.length < 2) return failure("EMPTY_REPLY", "Write a reply first", 422, requestId);

      const apps = await sql`SELECT a.*, o.title FROM applications a JOIN opportunities o ON o.id = a.opportunity_id WHERE a.id = ${replyMatch[1]} AND a.user_id = ${userId}`;
      const app = apps[0];
      if (!app) return failure("NOT_FOUND", "Application not found", 404, requestId);

      try {
        if (app.channel === "email") {
          const last = await sql`SELECT * FROM application_messages WHERE application_id = ${app.id} AND user_id = ${userId} AND direction = 'in' ORDER BY received_at DESC LIMIT 1`;
          if (!last[0]) return failure("NO_REPLY_YET", "There is no client message to answer yet", 409, requestId);
          const ref = String(last[0].message_ref || "");
          await gmailSend(env, sql, userId, app.recipient, `Re: Proposal: ${String(app.title).slice(0, 140)}`, content, {
            threadId: app.thread_id,
            messageId: ref,
            references: ref
          });
        } else if (app.channel === "freelancer") {
          const extra = JSON.parse(app.extra || "{}");
          const res = await fetch(
            `https://www.freelancer.com/api/messages/0.1/threads/?context_type=project&contexts[]=${encodeURIComponent(extra.project_id)}`,
            { headers: { "freelancer-oauth-v1": String(env.FREELANCER_TOKEN) } }
          );
          const data: any = await res.json();
          const threadId = data?.result?.threads?.[0]?.id;
          if (!threadId) throw new Error("No Freelancer.com thread found for this project");
          const post = await fetch(`https://www.freelancer.com/api/messages/0.1/threads/${threadId}/messages/`, {
            method: "POST",
            headers: { "freelancer-oauth-v1": String(env.FREELANCER_TOKEN), "Content-Type": "application/json" },
            body: JSON.stringify({ message: content })
          });
          if (!post.ok) throw new Error(`Freelancer HTTP ${post.status}`);
        } else {
          return failure("UNSUPPORTED", "Replies for this application must be sent on the original site", 409, requestId);
        }
      } catch (error) {
        return failure("SEND_FAILED", error instanceof Error ? error.message : "Sending failed", 502, requestId);
      }

      await sql`
        INSERT INTO application_messages (id, user_id, application_id, direction, sender, subject, body, external_id, received_at, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${app.id}, 'out', 'you', '', ${content}, ${"out:" + crypto.randomUUID()}, now(), now())
      `;
      return success({ sent: true }, "Reply sent", 200, requestId);
    }

    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
