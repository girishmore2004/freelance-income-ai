import { describe, expect, it, vi } from "vitest";
import type { Env, QueueMessage } from "../types";
import { MAX_ATTEMPTS, backoffSeconds, enqueueJob, isJobMessage, processQueueMessage, refreshWindow } from "./jobs";
import type { JobHandler, JobType } from "./jobs";
import { createFakeSql } from "./test-support";

function message(body: unknown, attempts = 1) {
  const ack = vi.fn();
  const retry = vi.fn();
  const m: QueueMessage = { id: "qm-1", timestamp: new Date(), body, attempts, ack, retry };
  return { m, ack, retry };
}

const JOB = { event_id: "job-1", event_type: "discovery.refresh", source: "test", created_at: "2026-11-17T00:00:00Z", payload: {} };
const env = {} as Env;

function handlers(fn: JobHandler): Record<JobType, JobHandler> {
  return { "infrastructure.health_check": fn, "discovery.refresh": fn, "replies.sync": fn };
}

describe("queue message validation", () => {
  it("accepts only known job types with an object payload", () => {
    expect(isJobMessage(JOB)).toBe(true);
    expect(isJobMessage({ ...JOB, event_type: "payments.payout" })).toBe(false);
    expect(isJobMessage({ ...JOB, payload: [] })).toBe(false);
    expect(isJobMessage({ ...JOB, event_id: "bad id with spaces" })).toBe(false);
  });

  it("retries invalid messages so Cloudflare dead-letters them", async () => {
    const { sql } = createFakeSql(() => []);
    const { m, ack, retry } = message({ nonsense: true });
    expect(await processQueueMessage(m, env, sql)).toBe("invalid");
    expect(ack).toHaveBeenCalledTimes(0);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("processing guarantees", () => {
  it("runs the handler once, records success and acknowledges", async () => {
    const handler = vi.fn(async () => ({ ran: true, drafted: 2 }));
    const fake = createFakeSql((text) =>
      text.startsWith("UPDATE background_jobs SET status = 'running'")
        ? [{ id: "job-1", user_id: "u1", job_type: "discovery.refresh", status: "running", attempts: 1, payload_json: "{}" }]
        : []
    );
    const { m, ack, retry } = message(JOB);
    expect(await processQueueMessage(m, env, fake.sql, { handlers: handlers(handler as unknown as JobHandler) })).toBe("acked-success");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(0);
    const done = fake.queries.find((q) => q.text.startsWith("UPDATE background_jobs SET status = 'succeeded'"));
    expect(done?.values[0]).toBe(JSON.stringify({ ran: true, drafted: 2 }));
  });

  it("does not repeat side effects for a duplicate delivery of a finished job", async () => {
    const handler = vi.fn(async () => ({}));
    const fake = createFakeSql((text) => (text.startsWith("SELECT status FROM background_jobs") ? [{ status: "succeeded" }] : []));
    const { m, ack } = message(JOB, 2);
    expect(await processQueueMessage(m, env, fake.sql, { handlers: handlers(handler as unknown as JobHandler) })).toBe("acked-duplicate");
    expect(handler).toHaveBeenCalledTimes(0);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("retries a failed handler with backoff and records the error", async () => {
    const fake = createFakeSql((text) =>
      text.startsWith("UPDATE background_jobs SET status = 'running'")
        ? [{ id: "job-1", user_id: "u1", job_type: "discovery.refresh", status: "running", attempts: 2, payload_json: "{}" }]
        : []
    );
    const { m, ack, retry } = message(JOB, 2);
    const failing: JobHandler = async () => {
      throw new Error("Remotive HTTP 503");
    };
    expect(await processQueueMessage(m, env, fake.sql, { handlers: handlers(failing) })).toBe("retried");
    expect(ack).toHaveBeenCalledTimes(0);
    expect(retry.mock.calls[0][0]).toEqual({ delaySeconds: backoffSeconds(2) });
    const update = fake.queries.find((q) => q.text.includes("status = 'retrying'"));
    expect(update?.values[0]).toBe("Remotive HTTP 503");
  });

  it("marks the job dead after the last attempt and hands it to the DLQ", async () => {
    const fake = createFakeSql((text) =>
      text.startsWith("UPDATE background_jobs SET status = 'running'")
        ? [{ id: "job-1", user_id: "u1", job_type: "replies.sync", status: "running", attempts: MAX_ATTEMPTS, payload_json: "{}" }]
        : []
    );
    const { m, retry } = message({ ...JOB, event_type: "replies.sync" }, MAX_ATTEMPTS);
    const failing: JobHandler = async () => {
      throw new Error("still failing");
    };
    expect(await processQueueMessage(m, env, fake.sql, { handlers: handlers(failing) })).toBe("dead");
    expect(fake.queries.some((q) => q.text.includes("status = 'dead'") && q.text.includes("dead_lettered_at = now()"))).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("acknowledges stateless health checks without a job row", async () => {
    const fake = createFakeSql(() => []);
    const { m, ack } = message({ ...JOB, event_type: "infrastructure.health_check" });
    expect(await processQueueMessage(m, env, fake.sql)).toBe("acked-stateless");
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("caps backoff at 15 minutes", () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(20)).toBe(900);
  });
});

describe("enqueue", () => {
  it("publishes once and returns the existing job for a repeated idempotency key", async () => {
    const send = vi.fn(async () => undefined);
    const queueEnv = { FREELANCE_JOBS: { send } } as unknown as Env;
    let insertCount = 0;
    const fake = createFakeSql((text) => {
      if (text.startsWith("INSERT INTO background_jobs")) {
        insertCount += 1;
        return insertCount === 1 ? [{ id: "new" }] : [];
      }
      if (text.startsWith("SELECT id, status FROM background_jobs")) return [{ id: "first-job", status: "queued" }];
      return [];
    });
    const first = await enqueueJob(queueEnv, fake.sql, { type: "discovery.refresh", userId: "u1", idempotencyKey: "k1" });
    const second = await enqueueJob(queueEnv, fake.sql, { type: "discovery.refresh", userId: "u1", idempotencyKey: "k1" });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ job_id: "first-job", status: "queued", duplicate: true });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = (send as unknown as { mock: { calls: [{ event_id: string; event_type: string }][] } }).mock.calls[0][0];
    expect(sent.event_id).toBe(first.job_id);
    expect(sent.event_type).toBe("discovery.refresh");
  });

  it("marks the row failed when publishing fails (no silent loss)", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue down");
    });
    const fake = createFakeSql((text) => (text.startsWith("INSERT INTO background_jobs") ? [{ id: "x" }] : []));
    await expect(enqueueJob({ FREELANCE_JOBS: { send } } as unknown as Env, fake.sql, { type: "replies.sync", userId: "u1" })).rejects.toThrow("QUEUE_PUBLISH_FAILED");
    expect(fake.queries.some((q) => q.text.includes("error_code = 'QUEUE_PUBLISH_FAILED'"))).toBe(true);
  });

  it("uses 6-hour windows for scheduled refresh keys", () => {
    const t = Date.UTC(2026, 10, 17, 1, 0, 0);
    expect(refreshWindow(t)).toBe(refreshWindow(t + 4 * 3_600_000));
    expect(refreshWindow(t)).not.toBe(refreshWindow(t + 6 * 3_600_000));
  });
});
