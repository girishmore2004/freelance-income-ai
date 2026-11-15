import type { Env } from "../types";
import {
  body,
  database,
  iso,
  num,
  oppOut,
  requireUser,
  text
} from "./core-routes";
import type { Row } from "./core-routes";
import {
  MIN_HOURS_BETWEEN_RUNS,
  draftForTopMatches,
  runDiscovery
} from "./discovery-agent";
import { failure, success } from "./response";

const OPPORTUNITY_STATUSES = new Set([
  "new",
  "drafted",
  "ready",
  "applied",
  "replied",
  "won",
  "lost",
  "skipped"
]);

const TASK_STATUSES = new Set(["todo", "in_progress", "done"]);
const INVOICE_STATUSES = new Set(["unpaid", "paid", "cancelled"]);

function projectOut(p: Row, tasks: Row[]) {
  return {
    id: p.id,
    origin_opportunity_id: p.origin_opportunity_id,
    title: p.title,
    client_name: p.client_name,
    description: p.description,
    status: p.status,
    budget: Number(p.budget),
    currency: p.currency,
    due_date: p.due_date,
    created_at: iso(p.created_at),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date
    }))
  };
}

function invoiceOut(i: Row) {
  return {
    id: i.id,
    project_id: i.project_id,
    invoice_number: i.invoice_number,
    amount: Number(i.amount),
    currency: i.currency,
    due_date: i.due_date,
    status: i.status,
    created_at: iso(i.created_at)
  };
}

const STARTER_TASKS: Array<[string, string]> = [
  ["Confirm scope, deliverables and timeline with the client in writing", "high"],
  ["Set up the workspace and share a short plan", "medium"],
  ["Build and test the first milestone", "medium"],
  ["Deliver the final work and get written acceptance", "high"],
  ["Send the invoice and record the payment", "medium"]
];

export async function handleWorkflowRoute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const statusMatch = path.match(/^\/api\/v1\/opportunities\/([\w-]{1,64})\/status$/);
  const projectMatch = path.match(/^\/api\/v1\/projects\/([\w-]{1,64})$/);
  const taskMatch = path.match(/^\/api\/v1\/tasks\/([\w-]{1,64})$/);
  const invoiceMatch = path.match(/^\/api\/v1\/invoices\/([\w-]{1,64})$/);

  const known =
    path === "/api/v1/discovery/status" ||
    path === "/api/v1/discovery/run" ||
    path === "/api/v1/discovery/draft" ||
    path === "/api/v1/projects" ||
    path === "/api/v1/invoices" ||
    statusMatch !== null ||
    projectMatch !== null ||
    taskMatch !== null ||
    invoiceMatch !== null;

  if (!known) return null;

  const user = await requireUser(request, env, requestId);
  if (user instanceof Response) return user;
  const userId = user;

  const sql = database(env);

  try {
    // ---- AI job discovery ---------------------------------------------------
    if (path === "/api/v1/discovery/status" && method === "GET") {
      const rows = await sql`
        SELECT summary, status, created_at FROM agent_runs
        WHERE user_id = ${userId} AND agent_name = 'discovery_agent'
        ORDER BY created_at DESC LIMIT 1
      `;
      const last = rows[0];

      return success(
        {
          last_run_at: last ? iso(last.created_at) : null,
          last_summary: last ? last.summary : null,
          next_allowed_at: last
            ? new Date(new Date(last.created_at).getTime() + MIN_HOURS_BETWEEN_RUNS * 3_600_000).toISOString()
            : null,
          sources: ["Remotive", "Jobicy"]
        },
        "Discovery status",
        200,
        requestId
      );
    }

    if (path === "/api/v1/discovery/run" && method === "POST") {
      const result = await runDiscovery(env, sql, userId);
      return success(result, result.ran ? "Search finished" : result.reason ?? "Search skipped", 200, requestId);
    }

    if (path === "/api/v1/discovery/draft" && method === "POST") {
      const drafted = await draftForTopMatches(env, sql, userId, 3);
      return success({ drafted }, `Drafted ${drafted} proposal(s) for review`, 200, requestId);
    }

    // ---- pipeline status ----------------------------------------------------
    if (statusMatch && method === "POST") {
      const b = await body(request);
      const status = typeof b?.status === "string" ? b.status : "";

      if (!OPPORTUNITY_STATUSES.has(status)) {
        return failure("INVALID_STATUS", `Status must be one of: ${[...OPPORTUNITY_STATUSES].join(", ")}`, 422, requestId);
      }

      const result = await sql.begin(async (tx) => {
        const rows = await tx`
          SELECT * FROM opportunities WHERE id = ${statusMatch[1]} AND user_id = ${userId} FOR UPDATE
        `;
        const opp = rows[0];
        if (!opp) return null;

        await tx`UPDATE opportunities SET status = ${status} WHERE id = ${opp.id}`;

        let project: Row | null = null;

        if (status === "won") {
          const existing = await tx`
            SELECT * FROM projects WHERE user_id = ${userId} AND origin_opportunity_id = ${opp.id} LIMIT 1
          `;

          if (existing[0]) {
            project = existing[0];
          } else {
            const priced = await tx`
              SELECT proposed_price, currency FROM proposals
              WHERE opportunity_id = ${opp.id} AND user_id = ${userId} AND proposed_price IS NOT NULL
              ORDER BY created_at DESC LIMIT 1
            `;
            const budget = num(priced[0]?.proposed_price) ?? num(opp.budget_max) ?? num(opp.budget_min) ?? 0;
            const currency = priced[0]?.currency || opp.currency || "INR";
            const projectId = crypto.randomUUID();

            await tx`
              INSERT INTO projects (
                id, user_id, origin_opportunity_id, title, client_name, description,
                status, delivery_audit_head_hash, budget, currency, due_date, created_at
              ) VALUES (
                ${projectId}, ${userId}, ${opp.id}, ${String(opp.title).slice(0, 300)},
                ${String(opp.client_name).slice(0, 200)}, ${String(opp.description).slice(0, 4000)},
                'active', '', ${budget}, ${currency}, '', now()
              )
            `;

            for (const [title, priority] of STARTER_TASKS) {
              await tx`
                INSERT INTO project_tasks (
                  id, user_id, project_id, title, description, status, priority,
                  due_date, planned_start_date, planned_finish_date, created_at
                ) VALUES (
                  ${crypto.randomUUID()}, ${userId}, ${projectId}, ${title}, '', 'todo', ${priority},
                  '', '', '', now()
                )
              `;
            }

            project = (await tx`SELECT * FROM projects WHERE id = ${projectId}`)[0];
          }
        }

        return { opp: (await tx`SELECT * FROM opportunities WHERE id = ${opp.id}`)[0], project };
      });

      if (!result) return failure("NOT_FOUND", "Opportunity not found", 404, requestId);

      return success(
        {
          opportunity: oppOut(result.opp),
          project_created: result.project ? { id: result.project.id, title: result.project.title } : null
        },
        status === "won" ? "Marked as won. A project with starter tasks was created." : `Marked as ${status}`,
        200,
        requestId
      );
    }

    // ---- projects and tasks -------------------------------------------------
    if (path === "/api/v1/projects" && method === "GET") {
      const projects = await sql`SELECT * FROM projects WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100`;
      const tasks = await sql`SELECT * FROM project_tasks WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1000`;

      return success(
        projects.map((p) => projectOut(p, tasks.filter((t) => t.project_id === p.id))),
        "Projects",
        200,
        requestId
      );
    }

    if (path === "/api/v1/projects" && method === "POST") {
      const b = await body(request);
      const title = typeof b?.title === "string" ? b.title.trim() : "";
      if (!b || title.length < 3) {
        return failure("INVALID_PROJECT", "Project title needs at least 3 characters.", 422, requestId);
      }

      const id = crypto.randomUUID();
      await sql`
        INSERT INTO projects (
          id, user_id, title, client_name, description, status,
          delivery_audit_head_hash, budget, currency, due_date, created_at
        ) VALUES (
          ${id}, ${userId}, ${title.slice(0, 300)}, ${text(b.client_name, 200)}, ${text(b.description, 4000)},
          'active', '', ${Math.max(0, num(b.budget) ?? 0)}, ${text(b.currency, 8, "INR") || "INR"},
          ${text(b.due_date, 80)}, now()
        )
      `;

      const row = (await sql`SELECT * FROM projects WHERE id = ${id}`)[0];
      return success(projectOut(row, []), "Project created", 201, requestId);
    }

    if (projectMatch && method === "PATCH") {
      const b = await body(request);
      const status = typeof b?.status === "string" ? b.status : "";
      if (!["active", "completed", "paused", "cancelled"].includes(status)) {
        return failure("INVALID_STATUS", "Status must be active, completed, paused or cancelled.", 422, requestId);
      }

      const updated = await sql`
        UPDATE projects SET status = ${status}
        WHERE id = ${projectMatch[1]} AND user_id = ${userId} RETURNING *
      `;
      if (!updated[0]) return failure("NOT_FOUND", "Project not found", 404, requestId);

      const tasks = await sql`SELECT * FROM project_tasks WHERE project_id = ${updated[0].id} AND user_id = ${userId}`;
      return success(projectOut(updated[0], tasks), "Project updated", 200, requestId);
    }

    if (taskMatch && method === "PATCH") {
      const b = await body(request);
      const status = typeof b?.status === "string" ? b.status : "";
      if (!TASK_STATUSES.has(status)) {
        return failure("INVALID_STATUS", "Status must be todo, in_progress or done.", 422, requestId);
      }

      const updated = await sql`
        UPDATE project_tasks
        SET status = ${status}, completed_at = ${status === "done" ? new Date() : null}
        WHERE id = ${taskMatch[1]} AND user_id = ${userId} RETURNING id, status
      `;
      if (!updated[0]) return failure("NOT_FOUND", "Task not found", 404, requestId);

      return success({ id: updated[0].id, status: updated[0].status }, "Task updated", 200, requestId);
    }

    // ---- invoices -----------------------------------------------------------
    if (path === "/api/v1/invoices" && method === "GET") {
      const rows = await sql`SELECT * FROM invoices WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 200`;
      return success(rows.map(invoiceOut), "Invoices", 200, requestId);
    }

    if (path === "/api/v1/invoices" && method === "POST") {
      const b = await body(request);
      const amount = num(b?.amount);
      if (!b || amount === null || amount <= 0) {
        return failure("INVALID_INVOICE", "Amount must be greater than zero.", 422, requestId);
      }

      let projectId: string | null = null;
      if (typeof b.project_id === "string" && b.project_id) {
        const owned = await sql`SELECT id FROM projects WHERE id = ${b.project_id} AND user_id = ${userId}`;
        if (!owned[0]) return failure("NOT_FOUND", "Project not found", 404, requestId);
        projectId = owned[0].id;
      }

      const [{ count }] = await sql`SELECT count(*) AS count FROM invoices WHERE user_id = ${userId}`;
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const number =
        text(b.invoice_number, 80).trim() || `INV-${today}-${String(Number(count) + 1).padStart(3, "0")}`;
      const id = crypto.randomUUID();

      await sql`
        INSERT INTO invoices (id, user_id, project_id, invoice_number, amount, currency, due_date, status, created_at)
        VALUES (${id}, ${userId}, ${projectId}, ${number}, ${amount}, ${text(b.currency, 8, "INR") || "INR"},
                ${text(b.due_date, 80)}, 'unpaid', now())
      `;

      const row = (await sql`SELECT * FROM invoices WHERE id = ${id}`)[0];
      return success(invoiceOut(row), "Invoice recorded (nothing was sent to a client)", 201, requestId);
    }

    if (invoiceMatch && method === "PATCH") {
      const b = await body(request);
      const status = typeof b?.status === "string" ? b.status : "";
      if (!INVOICE_STATUSES.has(status)) {
        return failure("INVALID_STATUS", "Status must be unpaid, paid or cancelled.", 422, requestId);
      }

      const result = await sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE invoices SET status = ${status}
          WHERE id = ${invoiceMatch[1]} AND user_id = ${userId} RETURNING *
        `;
        if (!rows[0]) return null;

        if (status === "paid") {
          await tx`
            INSERT INTO invoice_payment_events (
              id, user_id, invoice_id, event_type, amount, currency, reference,
              evidence_reference, note, occurred_at, created_at
            ) VALUES (
              ${crypto.randomUUID()}, ${userId}, ${rows[0].id}, 'payment', ${rows[0].amount},
              ${rows[0].currency}, '', '', 'Marked as paid manually', now(), now()
            )
          `;
        }
        return rows[0];
      });

      if (!result) return failure("NOT_FOUND", "Invoice not found", 404, requestId);
      return success(invoiceOut(result), `Invoice marked ${status}`, 200, requestId);
    }

    return null;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "workflow.route_failed",
        request_id: requestId,
        path,
        method,
        error_type: error instanceof Error ? error.name : "UnknownError",
        error_message: error instanceof Error ? error.message : "unknown"
      })
    );
    return failure("REQUEST_FAILED", "The request could not be completed. Please try again.", 503, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
