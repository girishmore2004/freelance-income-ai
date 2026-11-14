
import type { Env } from "./types";

import {
  applyCors,
  handlePreflight
} from "./lib/cors";

import {
  checkDatabase
} from "./lib/database";

import {
  failure,
  internalError,
  notFound,
  success
} from "./lib/response";

function createRequestId(): string {
  return crypto.randomUUID();
}

function logRequest(
  request: Request,
  requestId: string,
  startedAt: number,
  status: number
): void {
  console.log(
    JSON.stringify({
      event: "http.request",
      request_id: requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status,
      duration_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    })
  );
}

async function routeRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/") {
    return success(
      {
        application: env.APP_NAME ?? "Freelance Income AI",
        service: "freelance-income-ai-api-edge",
        version: env.APP_VERSION ?? "5.45.1",
        environment: env.APP_ENV ?? "staging",
        status: "operational",
        runtime: "cloudflare-workers",
        database: "neon-postgresql-hyperdrive",
        authentication_migration: "pending",
        full_application_migration: "in_progress"
      },
      "API gateway is running",
      200,
      requestId
    );
  }

  if (method === "GET" && path === "/health") {
    return success(
      {
        status: "healthy",
        runtime: "cloudflare-workers",
        service: "freelance-income-ai-api-edge"
      },
      "Health check successful",
      200,
      requestId
    );
  }

  if (method === "GET" && path === "/ready") {
    try {
      const database = await checkDatabase(env);

      return success(
        {
          status: "ready",
          database: database.connected ? "connected" : "unavailable",
          database_query: database.result,
          queue_binding: Boolean(env.FREELANCE_JOBS)
        },
        "Readiness check successful",
        200,
        requestId
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "readiness.database_failed",
          request_id: requestId,
          error_type:
            error instanceof Error
              ? error.name
              : "UnknownError"
        })
      );

      return failure(
        "SERVICE_NOT_READY",
        "Database readiness check failed",
        503,
        requestId
      );
    }
  }

  if (
    method === "GET" &&
    path === "/api/v1/health/database"
  ) {
    try {
      const database = await checkDatabase(env);

      return success(
        {
          provider: "Neon PostgreSQL",
          connection: "Cloudflare Hyperdrive",
          status: "connected",
          query_test: "passed",
          query_result: database.result
        },
        "Database health check successful",
        200,
        requestId
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "database.health_failed",
          request_id: requestId,
          error_type:
            error instanceof Error
              ? error.name
              : "UnknownError"
        })
      );

      return failure(
        "DATABASE_UNAVAILABLE",
        "Database connection or query failed",
        503,
        requestId
      );
    }
  }

  if (
    method === "GET" &&
    path === "/api/v1/deployment/info"
  ) {
    return success(
      {
        service: "freelance-income-ai-api-edge",
        version: env.APP_VERSION ?? "5.45.1",
        platform: "Cloudflare Workers",
        database: "Neon PostgreSQL",
        database_transport: "Hyperdrive",
        queue_enabled: Boolean(env.FREELANCE_JOBS),
        migration_stage: "phase_1_foundation",
        authentication_routes_migrated: false,
        business_routes_migrated: false,
        production_cutover_allowed: false
      },
      "Deployment information",
      200,
      requestId
    );
  }

  if (
    method === "GET" &&
    path === "/api/v1/migration/status"
  ) {
    return success(
      {
        phase: 1,
        foundation: "in_progress",
        authentication: "not_migrated",
        business_modules: "not_migrated",
        ai_modules: "not_migrated",
        document_modules: "not_migrated",
        queues: "binding_configured",
        production_cutover: false,
        next_phase: "authentication_and_database_schema"
      },
      "Migration status retrieved",
      200,
      requestId
    );
  }

  if (
    path.startsWith("/api/v1/auth/") &&
    ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
  ) {
    return failure(
      "AUTHENTICATION_NOT_MIGRATED",
      "Authentication routes are not yet implemented in this staging API. Continue using the existing production API.",
      501,
      requestId
    );
  }

  if (
    method === "POST" &&
    path === "/api/v1/queues/test"
  ) {
    if (!env.FREELANCE_JOBS) {
      return failure(
        "QUEUE_NOT_CONFIGURED",
        "The Cloudflare Queue producer binding is unavailable",
        503,
        requestId
      );
    }

    const jobId = crypto.randomUUID();

    try {
      await env.FREELANCE_JOBS.send({
        event_id: jobId,
        event_type: "infrastructure.health_check",
        source: "freelance-income-ai-api-edge",
        created_at: new Date().toISOString(),
        payload: {
          test: true
        }
      });

      return success(
        {
          job_id: jobId,
          status: "published"
        },
        "Queue test message published",
        202,
        requestId
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "queue.publish_failed",
          request_id: requestId,
          error_type:
            error instanceof Error
              ? error.name
              : "UnknownError"
        })
      );

      return failure(
        "QUEUE_PUBLISH_FAILED",
        "Unable to publish the queue test message",
        503,
        requestId
      );
    }
  }

  return notFound(path, requestId);
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const requestId = createRequestId();
    const startedAt = Date.now();

    let response: Response;

    if (request.method.toUpperCase() === "OPTIONS") {
      response = handlePreflight(
        request,
        env,
        requestId
      );
    } else {
      try {
        response = await routeRequest(
          request,
          env,
          requestId
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "request.unhandled_error",
            request_id: requestId,
            error_type:
              error instanceof Error
                ? error.name
                : "UnknownError"
          })
        );

        response = internalError(requestId);
      }
    }

    response = applyCors(
      request,
      response,
      env
    );

    const headers = new Headers(response.headers);
    headers.set("X-Request-ID", requestId);

    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });

    logRequest(
      request,
      requestId,
      startedAt,
      response.status
    );

    return response;
  }
};
