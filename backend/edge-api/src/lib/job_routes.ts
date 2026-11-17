import type { Env } from "../types";
import { database, requireUser } from "./core-routes";
import { failure, success } from "./response";
import { enqueueJob, listJobs } from "./jobs";

/**
 *   POST /api/v1/discovery/refresh   queue a discovery refresh for the caller
 *   GET  /api/v1/background-jobs     the caller's jobs (same shape as the Python route)
 */

const MANUAL_REFRESH_BUCKET_MS = 10 * 60_000;

export async function handleJobRoute(request: Request, env: Env, requestId: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const isRefresh = method === "POST" && path === "/api/v1/discovery/refresh";
  const isList = method === "GET" && path === "/api/v1/background-jobs";
  if (!isRefresh && !isList) return null;

  const user = await requireUser(request, env, requestId);
  if (user instanceof Response) return user;
  const sql = database(env);

  try {
    if (isList) {
      return success(await listJobs(sql, user), "Background jobs", 200, requestId);
    }

    if (!env.FREELANCE_JOBS) {
      return failure("QUEUE_NOT_CONFIGURED", "Background processing is not configured. Use “Find work now” instead.", 503, requestId);
    }
    // At most one manual refresh per user per 10-minute bucket; repeats return the same job.
    const bucket = Math.floor(Date.now() / MANUAL_REFRESH_BUCKET_MS);
    try {
      const result = await enqueueJob(env, sql, {
        type: "discovery.refresh",
        userId: user,
        payload: { trigger: "manual", force: false },
        idempotencyKey: `discovery.refresh:manual:${user}:${bucket}`
      });
      return success(
        result,
        result.duplicate ? "A refresh is already queued or recently ran" : "Discovery refresh queued",
        result.duplicate ? 200 : 202,
        requestId
      );
    } catch (error) {
      const code = error instanceof Error && error.message === "QUEUE_PUBLISH_FAILED" ? "QUEUE_PUBLISH_FAILED" : "QUEUE_UNAVAILABLE";
      return failure(code, "Could not queue the refresh. Please try again shortly.", 503, requestId);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
