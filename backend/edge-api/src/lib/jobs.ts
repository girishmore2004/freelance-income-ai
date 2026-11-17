import type { Env, QueueBatch, QueueMessage } from "../types";
import type { Sql } from "./core-routes";
import { database, iso } from "./core-routes";
import { draftForTopMatches, runDiscovery } from "./discovery-agent";
import { syncReplies } from "./apply-agent";
import { FLAGS, isEnabled } from "./flags";

/**
 * Durable, idempotent background jobs on Cloudflare Queues (finding 4).
 *
 * Every job is a row in `background_jobs` (shared with the Python RQ worker)
 * whose id is also the queue message `event_id`.
 *
 * Guarantees:
 *  - Enqueue is idempotent: a job with the same `idempotency_key` is created
 *    once and published once (unique index from migration 0048).
 *  - Processing is claimed atomically (`queued|retrying -> running`), so a
 *    duplicate delivery of the same message never repeats the side effect;
 *    a succeeded job is acknowledged without running again.
 *  - A job stuck in `running` longer than STALE_RUNNING_MINUTES (worker
 *    crashed mid-run) may be reclaimed by a later delivery.
 *  - Failures are retried with exponential backoff; after MAX_ATTEMPTS the
 *    job is marked `dead` and the message is left to Cloudflare's dead-letter
 *    queue (`freelance-income-ai-jobs-dlq`).
 */

export const JOB_TYPES = ["infrastructure.health_check", "discovery.refresh", "replies.sync"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const MAX_ATTEMPTS = 5;
export const STALE_RUNNING_MINUTES = 15;

export interface JobMessage {
  event_id: string;
  event_type: JobType;
  source: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface JobRow {
  id: string;
  user_id: string;
  job_type: string;
  status: string;
  attempts: number;
  payload_json: string;
}

export type JobHandler = (ctx: { env: Env; sql: Sql; job: JobRow; payload: Record<string, unknown> }) => Promise<Record<string, unknown>>;

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_HANDLERS: Record<JobType, JobHandler> = {
  "infrastructure.health_check": async () => ({ ok: true, processed_at: new Date().toISOString() }),

  // Source refresh: the first real queue vertical slice. Runs the same
  // discovery the cron used to run inline, then drafts (never sends)
  // proposals for the best new matches.
  "discovery.refresh": async ({ env, sql, job, payload }) => {
    const result = await runDiscovery(env, sql, job.user_id, { force: payload.force === true });
    const drafted = result.ran && payload.draft !== false ? await draftForTopMatches(env, sql, job.user_id, 3) : 0;
    return { ...result, drafted };
  },

  "replies.sync": async ({ env, sql, job }) => {
    const result = await syncReplies(env, sql, job.user_id);
    if (result.errors.length && result.checked === 0 && result.new_messages === 0) {
      throw new Error(`Reply sync failed: ${result.errors[0]}`);
    }
    return result;
  }
};

/* ------------------------------------------------------------------ */
/* Producer                                                            */
/* ------------------------------------------------------------------ */

export interface EnqueueInput {
  type: JobType;
  userId: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EnqueueResult {
  job_id: string;
  status: string;
  duplicate: boolean;
}

export async function enqueueJob(env: Env, sql: Sql, input: EnqueueInput): Promise<EnqueueResult> {
  if (!JOB_TYPES.includes(input.type)) throw new Error(`Unknown job type ${input.type}`);
  const payload = input.payload ?? {};
  const key = input.idempotencyKey ?? null;
  const id = crypto.randomUUID();

  const inserted = await sql<{ id: string }[]>`
    INSERT INTO background_jobs
      (id, user_id, job_type, status, rq_job_id, result_json, error_message, error_code, last_error_node,
       created_at, idempotency_key, attempts, payload_json, source)
    VALUES
      (${id}, ${input.userId}, ${input.type}, 'queued', '', '{}', '', '', '',
       now(), ${key}, 0, ${JSON.stringify(payload)}, 'edge')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;

  if (!inserted.length) {
    const existing = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM background_jobs WHERE idempotency_key = ${key} LIMIT 1
    `;
    return { job_id: existing[0]?.id ?? "", status: existing[0]?.status ?? "unknown", duplicate: true };
  }

  if (!env.FREELANCE_JOBS) {
    await sql`
      UPDATE background_jobs SET status = 'failed', error_code = 'QUEUE_NOT_CONFIGURED',
        error_message = 'Queue producer binding is not configured', finished_at = now()
      WHERE id = ${id}
    `;
    throw new Error("QUEUE_NOT_CONFIGURED");
  }

  const message: JobMessage = {
    event_id: id,
    event_type: input.type,
    source: "freelance-income-ai-api-edge",
    created_at: new Date().toISOString(),
    payload
  };
  try {
    await env.FREELANCE_JOBS.send(message);
  } catch (error) {
    await sql`
      UPDATE background_jobs SET status = 'failed', error_code = 'QUEUE_PUBLISH_FAILED',
        error_message = ${error instanceof Error ? error.message.slice(0, 500) : "publish failed"}, finished_at = now()
      WHERE id = ${id}
    `;
    throw new Error("QUEUE_PUBLISH_FAILED");
  }
  return { job_id: id, status: "queued", duplicate: false };
}

/* ------------------------------------------------------------------ */
/* Consumer                                                            */
/* ------------------------------------------------------------------ */

export function isJobMessage(value: unknown): value is JobMessage {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.event_id === "string" &&
    /^[\w-]{1,64}$/.test(job.event_id) &&
    typeof job.event_type === "string" &&
    (JOB_TYPES as readonly string[]).includes(job.event_type) &&
    typeof job.source === "string" &&
    typeof job.created_at === "string" &&
    typeof job.payload === "object" &&
    job.payload !== null &&
    !Array.isArray(job.payload)
  );
}

export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 900);
}

export type Outcome = "acked-success" | "acked-duplicate" | "acked-stateless" | "retried" | "dead" | "invalid";

export interface ConsumerDeps {
  handlers: Record<JobType, JobHandler>;
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event, ...fields }));
}

export async function processQueueMessage(
  message: QueueMessage,
  env: Env,
  sql: Sql,
  deps: ConsumerDeps = { handlers: DEFAULT_HANDLERS }
): Promise<Outcome> {
  const body = message.body;
  if (!isJobMessage(body)) {
    log("queue.invalid_message", { queue_message_id: message.id, attempts: message.attempts });
    // Let Cloudflare retry and then dead-letter it; it is kept for inspection.
    message.retry({ delaySeconds: 60 });
    return "invalid";
  }

  // Stateless health check (also used by POST /api/v1/queues/test): no row needed.
  if (body.event_type === "infrastructure.health_check") {
    const claimed = await sql<JobRow[]>`SELECT id FROM background_jobs WHERE id = ${body.event_id}`;
    if (!claimed.length) {
      message.ack();
      log("queue.health_check_processed", { event_id: body.event_id });
      return "acked-stateless";
    }
  }

  const claimed = await sql<JobRow[]>`
    UPDATE background_jobs
    SET status = 'running', attempts = attempts + 1, started_at = now(), error_message = '', error_code = ''
    WHERE id = ${body.event_id}
      AND (status IN ('queued', 'retrying')
           OR (status = 'running' AND started_at < now() - make_interval(mins => ${STALE_RUNNING_MINUTES})))
    RETURNING id, user_id, job_type, status, attempts, payload_json
  `;
  const job = claimed[0];

  if (!job) {
    const current = await sql<{ status: string }[]>`SELECT status FROM background_jobs WHERE id = ${body.event_id}`;
    // Succeeded, dead, failed, cancelled, actively running or unknown:
    // never run the side effect again for a duplicate delivery.
    message.ack();
    log("queue.duplicate_or_unclaimable", { event_id: body.event_id, status: current[0]?.status ?? "missing" });
    return "acked-duplicate";
  }

  const handler = deps.handlers[job.job_type as JobType];
  try {
    if (!handler) throw new Error(`No handler for ${job.job_type}`);
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(job.payload_json || "{}") as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const result = await handler({ env, sql, job, payload });
    await sql`
      UPDATE background_jobs SET status = 'succeeded', result_json = ${JSON.stringify(result).slice(0, 20_000)}, finished_at = now()
      WHERE id = ${job.id}
    `;
    message.ack();
    log("queue.job_succeeded", { event_id: job.id, job_type: job.job_type, attempts: job.attempts });
    return "acked-success";
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "unknown error").slice(0, 500);
    if (job.attempts >= MAX_ATTEMPTS) {
      await sql`
        UPDATE background_jobs SET status = 'dead', error_code = 'RETRIES_EXHAUSTED', error_message = ${reason},
          finished_at = now(), dead_lettered_at = now()
        WHERE id = ${job.id}
      `;
      // Hand the message to Cloudflare's DLQ (max_retries is exceeded).
      message.retry({ delaySeconds: 0 });
      log("queue.job_dead", { event_id: job.id, job_type: job.job_type, attempts: job.attempts, error: reason });
      return "dead";
    }
    await sql`
      UPDATE background_jobs SET status = 'retrying', error_code = 'HANDLER_FAILED', error_message = ${reason}
      WHERE id = ${job.id}
    `;
    message.retry({ delaySeconds: backoffSeconds(job.attempts) });
    log("queue.job_retry", { event_id: job.id, job_type: job.job_type, attempts: job.attempts, error: reason });
    return "retried";
  }
}

export async function processQueueBatch(batch: QueueBatch, env: Env, deps?: ConsumerDeps): Promise<Outcome[]> {
  const sql = database(env);
  const outcomes: Outcome[] = [];
  try {
    for (const message of batch.messages) {
      try {
        outcomes.push(await processQueueMessage(message, env, sql, deps));
      } catch (error) {
        // Database unavailable or similar: retry the message later.
        message.retry({ delaySeconds: 60 });
        outcomes.push("retried");
        log("queue.consumer_error", { queue_message_id: message.id, error: error instanceof Error ? error.message : "unknown" });
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Scheduling and read model                                           */
/* ------------------------------------------------------------------ */

/** 6-hour window id, so the cron enqueues at most one refresh per user per window. */
export function refreshWindow(now = Date.now()): string {
  return String(Math.floor(now / (6 * 3_600_000)));
}

export async function enqueueScheduledRefresh(env: Env, sql: Sql, limit = 50): Promise<{ enqueued: number; duplicates: number; failed: number }> {
  const users = await sql<{ user_id: string }[]>`
    SELECT user_id FROM profiles WHERE skills <> '[]' ORDER BY user_id LIMIT ${Math.max(1, Math.min(limit, 500))}
  `;
  const window = refreshWindow();
  const totals = { enqueued: 0, duplicates: 0, failed: 0 };
  for (const row of users) {
    try {
      const result = await enqueueJob(env, sql, {
        type: "discovery.refresh",
        userId: row.user_id,
        payload: { trigger: "schedule" },
        idempotencyKey: `discovery.refresh:${row.user_id}:${window}`
      });
      if (result.duplicate) totals.duplicates += 1;
      else totals.enqueued += 1;
    } catch {
      totals.failed += 1;
    }
  }
  return totals;
}

export async function listJobs(sql: Sql, userId: string): Promise<Record<string, unknown>[]> {
  const rows = await sql`
    SELECT id, job_type, status, result_json, error_message, attempts, source, created_at, started_at, finished_at
    FROM background_jobs WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50
  `;
  return rows.map((row) => {
    let result: unknown = {};
    try {
      result = JSON.parse(String(row.result_json || "{}"));
    } catch {
      result = {};
    }
    return {
      id: row.id,
      job_type: row.job_type,
      status: row.status,
      result,
      error: row.error_message,
      attempts: Number(row.attempts ?? 0),
      source: row.source,
      created_at: iso(row.created_at),
      started_at: iso(row.started_at),
      finished_at: iso(row.finished_at)
    };
  });
}

/** Queue health for alerting: counts and age of the oldest waiting job. */
export async function queueHealth(sql: Sql): Promise<{ waiting: number; oldest_waiting_seconds: number; dead_24h: number; failed_24h: number }> {
  const rows = await sql<{ waiting: string; oldest: string | null; dead: string; failed: string }[]>`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'retrying')) AS waiting,
      EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status IN ('queued', 'retrying')))) AS oldest,
      count(*) FILTER (WHERE status = 'dead' AND dead_lettered_at > now() - interval '24 hours') AS dead,
      count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '24 hours') AS failed
    FROM background_jobs WHERE source = 'edge'
  `;
  const row = rows[0];
  return {
    waiting: Number(row?.waiting ?? 0),
    oldest_waiting_seconds: Math.round(Number(row?.oldest ?? 0)),
    dead_24h: Number(row?.dead ?? 0),
    failed_24h: Number(row?.failed ?? 0)
  };
}

export async function runScheduledQueueMaintenance(env: Env): Promise<void> {
  const sql = database(env);
  try {
    if (env.FREELANCE_JOBS && (await isEnabled(env, sql, FLAGS.scheduledDiscovery, true))) {
      const totals = await enqueueScheduledRefresh(env, sql);
      log("queue.scheduled_refresh", totals);
    }
    const health = await queueHealth(sql);
    const alert = health.oldest_waiting_seconds > 3600 || health.dead_24h > 0 || health.waiting > 500;
    // Workers Observability alert rules match on event "queue.health" + alert=true.
    console[alert ? "warn" : "log"](JSON.stringify({ service: "freelance-income-ai-api-edge", event: "queue.health", alert, ...health }));
  } catch (error) {
    log("queue.maintenance_failed", { error: error instanceof Error ? error.message : "unknown" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
