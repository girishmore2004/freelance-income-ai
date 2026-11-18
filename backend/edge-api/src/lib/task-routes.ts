import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, organizationForMember } from "./identity";
import { contractVersionOut } from "./contracts";
import type { ContractMilestone, ContractRow, ContractVersionRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";
import { tableExists } from "./external-pipeline";
import { parseTemplate } from "./listing-routes";
import { screenText } from "./listings";

/**
 * Contract workspace "Tasks" and "Handover" tabs (U11, spec §11).
 *
 *   GET  /api/v1/contracts/{id}/tasks                    parties; {tasks, can_edit, stages, milestones}
 *   POST /api/v1/contracts/{id}/tasks {title, owner_party?, milestone_index?, due_date?}
 *   POST /api/v1/contracts/{id}/tasks/plan                one-time plan from the work category's stages (deterministic)
 *   POST /api/v1/contract-tasks/{id} {status?, title?, owner_party?, due_date?, milestone_index?}
 *   POST /api/v1/contract-tasks/{id}/delete
 *   GET  /api/v1/contracts/{id}/handover                  parties
 *   POST /api/v1/contracts/{id}/handover {kind, title, link?, note?}   freelancer, active or completed
 *   POST /api/v1/handover-items/{id}/confirm              client owner/admin
 *   POST /api/v1/handover-items/{id}/withdraw             freelancer, while pending
 *
 * Writers: the freelancer and the client's owners/admins; tasks only while the
 * contract is active. Handover text refuses contact details and anything that
 * looks like a password or key: access is transferred through each service's
 * own invitation feature.
 */

export interface TaskRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: TaskRouteDeps = { database, authenticate: authenticateRequest };

export const MAX_TASKS = 200;
const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const HANDOVER_KINDS = ["source_files", "documentation", "access_transfer", "deployment", "other"] as const;
const SECRET = /(pass(word|wd)?|pwd|secret|api[\s_-]?key|private[\s_-]?key|token|otp)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{12,}/i;

/** True when the text looks like it carries a secret. Pure, exported for tests. */
export function looksSecret(text: string): boolean {
  return SECRET.test(text);
}

const CLIENT_STAGE = /\b(approval|approve|review|feedback|sign[\s-]?off|acceptance|uat|brief|requirements?)\b/i;

/**
 * One task per category stage, spread over the milestones in order; review-type
 * stages belong to the client. Due date = the milestone's due date. Pure, exported for tests.
 */
export function planFromStages(stages: string[], milestones: ContractMilestone[]): Array<{ title: string; owner_party: Party; milestone_index: number | null; due_date: string | null; position: number }> {
  const clean = stages.map((s) => s.trim()).filter(Boolean).slice(0, 30);
  const m = milestones.length;
  return clean.map((title, i) => {
    const milestone = m ? Math.min(m - 1, Math.floor((i * m) / clean.length)) : null;
    return {
      title: title.slice(0, 200),
      owner_party: CLIENT_STAGE.test(title) ? "client" : "freelancer",
      milestone_index: milestone,
      due_date: milestone === null ? null : milestones[milestone]?.due_date ?? null,
      position: i
    };
  });
}

type TaskInput = { title?: string; owner_party?: Party; milestone_index?: number | null; due_date?: string | null; status?: string };

export function validateTask(input: Record<string, unknown>, milestoneCount: number, partial: boolean): { ok: true; value: TaskInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const value: TaskInput = {};
  if (!partial || input.title !== undefined) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title.length < 2 || title.length > 200) errors.title = "Give the task a title (2–200 characters).";
    else if (screenText(title).length) errors.title = "Keep contact and payment details out of tasks.";
    else value.title = title;
  }
  if (input.owner_party !== undefined) {
    if (input.owner_party !== "client" && input.owner_party !== "freelancer") errors.owner_party = "Choose client or freelancer.";
    else value.owner_party = input.owner_party;
  } else if (!partial) value.owner_party = "freelancer";
  if (input.milestone_index !== undefined && input.milestone_index !== null && input.milestone_index !== "") {
    const n = Number(input.milestone_index);
    if (!Number.isInteger(n) || n < 0 || n >= milestoneCount) errors.milestone_index = "Choose one of the contract's milestones.";
    else value.milestone_index = n;
  } else if (input.milestone_index === null || input.milestone_index === "") value.milestone_index = null;
  if (input.due_date !== undefined && input.due_date !== null && input.due_date !== "") {
    const d = String(input.due_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) errors.due_date = "Use a date (YYYY-MM-DD).";
    else value.due_date = d;
  } else if (input.due_date === null || input.due_date === "") value.due_date = null;
  if (input.status !== undefined) {
    if (!TASK_STATUSES.includes(input.status as (typeof TASK_STATUSES)[number])) errors.status = "Status must be to do, doing or done.";
    else value.status = String(input.status);
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

export function validateHandover(input: Record<string, unknown>): { ok: true; value: { kind: string; title: string; link: string; note: string } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (!HANDOVER_KINDS.includes(kind as (typeof HANDOVER_KINDS)[number])) errors.kind = "Choose what you are handing over.";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 2 || title.length > 200) errors.title = "Describe the item (2–200 characters).";
  let link = typeof input.link === "string" ? input.link.trim() : "";
  if (link) {
    try {
      const u = new URL(link);
      if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) errors.link = "Use a full https link without a user name or password.";
      else link = u.toString();
    } catch {
      errors.link = "Use a full https link.";
    }
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 2000) errors.note = "Keep the note under 2,000 characters.";
  for (const [field, text] of [["title", title], ["note", note], ["link", link]] as const) {
    if (!errors[field] && looksSecret(text)) errors[field] = "Never paste passwords or keys. Invite the client through the service's own sharing or team feature instead.";
    else if (!errors[field] && field !== "link" && screenText(text).length) errors[field] = "Keep contact and payment details out of the handover.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { kind, title, link, note } };
}

type Side = { party: Party; canManage: boolean };
type TaskRow = { id: string; contract_id: string; title: string; milestone_index: number | null; owner_party: Party; due_date: string | Date | null; status: string; source: string; position: number; created_by: string | null; created_at: Date; updated_at: Date; completed_at: Date | null };
type HandoverRow = { id: string; contract_id: string; kind: string; title: string; link: string; note: string; status: string; created_by: string | null; created_at: Date; confirmed_by: string | null; confirmed_at: Date | null };

const day = (v: string | Date | null) => (v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const iso = (v: Date | null) => (v ? new Date(v).toISOString() : null);
const taskOut = (t: TaskRow) => ({ id: t.id, title: t.title, milestone_index: t.milestone_index, owner_party: t.owner_party, due_date: day(t.due_date), status: t.status, source: t.source, position: t.position, completed_at: iso(t.completed_at), updated_at: iso(t.updated_at) });
const handoverOut = (h: HandoverRow) => ({ id: h.id, kind: h.kind, title: h.title, link: h.link, note: h.note, status: h.status, created_at: iso(h.created_at), confirmed_at: iso(h.confirmed_at) });

async function sideOf(sql: Queryable, userId: string, contract: ContractRow): Promise<Side | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  return org ? { party: "client", canManage: canManageOrganization(org.membership_role) } : null;
}

async function milestonesOf(sql: Queryable, contract: ContractRow): Promise<ContractMilestone[]> {
  const v = (await sql<ContractVersionRow[]>`
    SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
  `)[0];
  return v ? contractVersionOut(v).milestones : [];
}

export async function handleTaskRoute(request: Request, env: Env, requestId: string, deps: TaskRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const onContract = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/(tasks|tasks\/plan|handover)$/);
  const onTask = path.match(/^\/api\/v1\/contract-tasks\/([\w-]{1,64})(\/delete)?$/);
  const onItem = path.match(/^\/api\/v1\/handover-items\/([\w-]{1,64})\/(confirm|withdraw)$/);
  const known =
    (onContract !== null && (method === "POST" || (method === "GET" && onContract[2] !== "tasks/plan"))) ||
    (onTask !== null && method === "POST") ||
    (onItem !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    const ready = await tableExists(sql, "contract_tasks");

    // Resolve the contract from whichever id the path carries.
    let contractId = onContract?.[1] ?? "";
    let task: TaskRow | undefined;
    let item: HandoverRow | undefined;
    if (ready && onTask) {
      task = (await sql<TaskRow[]>`SELECT * FROM contract_tasks WHERE id = ${onTask[1]} LIMIT 1`)[0];
      contractId = task?.contract_id ?? "";
    }
    if (ready && onItem) {
      item = (await sql<HandoverRow[]>`SELECT * FROM contract_handover_items WHERE id = ${onItem[1]} LIMIT 1`)[0];
      contractId = item?.contract_id ?? "";
    }
    const contract = contractId ? (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0] : undefined;
    const side = contract ? await sideOf(sql, userId, contract) : null;
    if (!contract || !side) return failure("NOT_FOUND", "Not found", 404, requestId);

    const kind = onContract?.[2];
    if (!ready) {
      if (method === "GET") return success(kind === "handover" ? { items: [], can_add: false, can_confirm: false, available: false } : { tasks: [], can_edit: false, stages: [], milestones: [], available: false }, "Not available yet", 200, requestId);
      return failure("MIGRATION_PENDING", "Tasks and handover need database migration 0072.", 503, requestId);
    }

    // ---------------- tasks ----------------
    if (kind === "tasks" || kind === "tasks/plan" || onTask) {
      const canEdit = side.canManage && contract.status === "active";
      const milestones = await milestonesOf(sql, contract);
      if (method === "GET") {
        const [rows, category] = await Promise.all([
          sql<TaskRow[]>`SELECT * FROM contract_tasks WHERE contract_id = ${contract.id} ORDER BY position ASC, created_at ASC LIMIT ${MAX_TASKS}`,
          sql<Array<{ template_json: string }>>`
            SELECT c.template_json FROM project_listings l JOIN project_categories c ON c.slug = l.category_slug WHERE l.id = ${contract.listing_id} LIMIT 1
          `
        ]);
        return success(
          { available: true, tasks: rows.map(taskOut), can_edit: canEdit, stages: parseTemplate(category[0]?.template_json ?? "").stages, milestones: milestones.map((m, index) => ({ index, title: m.title, due_date: m.due_date })) },
          "Tasks",
          200,
          requestId
        );
      }
      if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins of the client account edit tasks.", 403, requestId);
      if (contract.status !== "active") return failure("CONTRACT_NOT_ACTIVE", "Tasks can change while the contract is active.", 409, requestId);

      if (kind === "tasks/plan") {
        const category = (await sql<Array<{ template_json: string }>>`
          SELECT c.template_json FROM project_listings l JOIN project_categories c ON c.slug = l.category_slug WHERE l.id = ${contract.listing_id} LIMIT 1
        `)[0];
        const plan = planFromStages(parseTemplate(category?.template_json ?? "").stages, milestones);
        if (!plan.length) return failure("NO_STAGES", "This work category has no standard stages. Add tasks yourself.", 409, requestId);
        const created = await sql.begin(async (tx) => {
          await tx`SELECT id FROM contracts WHERE id = ${contract.id} FOR UPDATE`;
          const existing = (await tx<Array<{ n: number }>>`SELECT count(*)::int AS n FROM contract_tasks WHERE contract_id = ${contract.id}`)[0]?.n ?? 0;
          if (existing > 0) return null;
          for (const p of plan) {
            await tx`
              INSERT INTO contract_tasks (id, contract_id, title, milestone_index, owner_party, due_date, status, source, position, created_by, created_at, updated_at)
              VALUES (${crypto.randomUUID()}, ${contract.id}, ${p.title}, ${p.milestone_index}, ${p.owner_party}, ${p.due_date}, 'todo', 'category_plan', ${p.position}, ${userId}, now(), now())
            `;
          }
          await recordContractEvent(tx, contract.id, userId, side.party, "tasks.planned", { tasks: plan.length });
          return plan.length;
        });
        if (created === null) return failure("PLAN_EXISTS", "This contract already has tasks. Add more one by one.", 409, requestId);
        return success({ created }, `Added ${created} tasks from the category's stages`, 201, requestId);
      }

      if (onTask) {
        if (!task) return failure("NOT_FOUND", "Task not found", 404, requestId);
        if (onTask[2]) {
          await sql`DELETE FROM contract_tasks WHERE id = ${task.id}`;
          return success({ id: task.id }, "Task removed", 200, requestId);
        }
        const v = validateTask((await body(request)) ?? {}, milestones.length, true);
        if (!v.ok) return failure("INVALID_TASK", "Check the highlighted fields.", 422, requestId, [v.errors]);
        const next = { ...taskOut(task), ...v.value };
        const rows = await sql<TaskRow[]>`
          UPDATE contract_tasks SET title = ${next.title}, owner_party = ${next.owner_party}, milestone_index = ${next.milestone_index}, due_date = ${next.due_date},
                 status = ${next.status}, updated_at = now(),
                 completed_at = CASE WHEN ${next.status} = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE id = ${task.id} RETURNING *
        `;
        return success(taskOut(rows[0]), "Task updated", 200, requestId);
      }

      // create
      const v = validateTask((await body(request)) ?? {}, milestones.length, false);
      if (!v.ok) return failure("INVALID_TASK", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const count = (await sql<Array<{ n: number; p: number }>>`SELECT count(*)::int AS n, COALESCE(max(position), -1)::int AS p FROM contract_tasks WHERE contract_id = ${contract.id}`)[0] ?? { n: 0, p: -1 };
      if (count.n >= MAX_TASKS) return failure("LIMIT_REACHED", `A contract can have up to ${MAX_TASKS} tasks.`, 409, requestId);
      const rows = await sql<TaskRow[]>`
        INSERT INTO contract_tasks (id, contract_id, title, milestone_index, owner_party, due_date, status, source, position, created_by, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${contract.id}, ${v.value.title!}, ${v.value.milestone_index ?? null}, ${v.value.owner_party ?? "freelancer"}, ${v.value.due_date ?? null},
                'todo', 'manual', ${count.p + 1}, ${userId}, now(), now())
        RETURNING *
      `;
      return success(taskOut(rows[0]), "Task added", 201, requestId);
    }

    // ---------------- handover ----------------
    if (method === "GET") {
      const rows = await sql<HandoverRow[]>`SELECT * FROM contract_handover_items WHERE contract_id = ${contract.id} AND status <> 'withdrawn' ORDER BY created_at ASC LIMIT 100`;
      return success(
        {
          available: true,
          items: rows.map(handoverOut),
          can_add: side.party === "freelancer" && ["active", "completed"].includes(contract.status),
          can_confirm: side.party === "client" && side.canManage,
          kinds: HANDOVER_KINDS
        },
        "Handover",
        200,
        requestId
      );
    }

    if (onItem) {
      if (!item || item.status === "withdrawn") return failure("NOT_FOUND", "Item not found", 404, requestId);
      if (onItem[2] === "withdraw") {
        if (side.party !== "freelancer") return failure("FORBIDDEN", "The freelancer withdraws handover items.", 403, requestId);
        const rows = await sql<HandoverRow[]>`UPDATE contract_handover_items SET status = 'withdrawn' WHERE id = ${item.id} AND status = 'pending' RETURNING *`;
        if (!rows[0]) return failure("ALREADY_CONFIRMED", "The client already confirmed this item.", 409, requestId);
        return success(handoverOut(rows[0]), "Item withdrawn", 200, requestId);
      }
      if (side.party !== "client" || !side.canManage) return failure("FORBIDDEN", "Owners and admins of the client account confirm receipt.", 403, requestId);
      const rows = await sql<HandoverRow[]>`
        UPDATE contract_handover_items SET status = 'confirmed', confirmed_by = ${userId}, confirmed_at = now() WHERE id = ${item.id} AND status = 'pending' RETURNING *
      `;
      if (!rows[0]) return failure("ALREADY_CONFIRMED", "This item is already confirmed.", 409, requestId);
      await recordContractEvent(sql, contract.id, userId, "client", "handover.confirmed", { title: item.title });
      return success(handoverOut(rows[0]), "Receipt confirmed", 200, requestId);
    }

    if (side.party !== "freelancer") return failure("FORBIDDEN", "The freelancer adds handover items; the client confirms them.", 403, requestId);
    if (!["active", "completed"].includes(contract.status)) return failure("CONTRACT_NOT_ACTIVE", "Handover is open while the contract is active or completed.", 409, requestId);
    const v = validateHandover((await body(request)) ?? {});
    if (!v.ok) return failure("INVALID_HANDOVER", "Check the highlighted fields.", 422, requestId, [v.errors]);
    const n = (await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM contract_handover_items WHERE contract_id = ${contract.id} AND status <> 'withdrawn'`)[0]?.n ?? 0;
    if (n >= 100) return failure("LIMIT_REACHED", "A contract can have up to 100 handover items.", 409, requestId);
    const rows = await sql<HandoverRow[]>`
      INSERT INTO contract_handover_items (id, contract_id, kind, title, link, note, status, created_by, created_at)
      VALUES (${crypto.randomUUID()}, ${contract.id}, ${v.value.kind}, ${v.value.title}, ${v.value.link}, ${v.value.note}, 'pending', ${userId}, now())
      RETURNING *
    `;
    await recordContractEvent(sql, contract.id, userId, "freelancer", "handover.added", { title: v.value.title, kind: v.value.kind });
    return success(handoverOut(rows[0]), "Added to the handover", 201, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
