import type { Env } from "./types";

import { handleLoginRoute } from "./lib/login-route";
import { handleAuthRoute } from "./lib/auth-routes";
import { handleMfaLoginRoute } from "./lib/mfa-login-route";
import { handleRegisterRoute } from "./lib/register-route";
import { handleCoreRoute } from "./lib/core-routes";
import { handleWorkflowRoute } from "./lib/workflow-routes";
import { handleApplyRoute } from "./lib/apply-routes";
import { runScheduledReplySync } from "./lib/apply-agent";
import { runScheduledDiscovery } from "./lib/discovery-agent";
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

  // --------------------------------------------------
  // Root endpoint
  // --------------------------------------------------

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
        authentication_migration: "partial",
        full_application_migration: "in_progress"
      },
      "API gateway is running",
      200,
      requestId
    );
  }

  // --------------------------------------------------
  // Health endpoint
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Readiness endpoint
  // --------------------------------------------------

  if (method === "GET" && path === "/ready") {
    try {
      const database = await checkDatabase(env);

      return success(
        {
          status: "ready",
          database: database.connected
            ? "connected"
            : "unavailable",
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

  // --------------------------------------------------
  // Database health endpoint
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Deployment information
  // --------------------------------------------------

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
        migration_stage: "authentication_partial",
        authentication: {
          login_route: "implemented",
          session_validation: "implemented",
          logout_routes: "implemented",
          registration: "pending",
          mfa_verification: "pending",
          password_reset: "pending"
        },
        business_routes_migrated: false,
        production_cutover_allowed: false
      },
      "Deployment information",
      200,
      requestId
    );
  }

  // --------------------------------------------------
  // Migration status
  // --------------------------------------------------

  if (
    method === "GET" &&
    path === "/api/v1/migration/status"
  ) {
    return success(
      {
        phase: 1,
        foundation: "implemented",
        authentication: "partial",
        authentication_features: {
          password_verification: "implementation_pending_validation",
          login: "implemented_pending_testing",
          session_creation: "implemented_pending_testing",
          session_validation: "implemented_pending_testing",
          logout: "implemented_pending_testing",
          registration: "not_migrated",
          mfa_verification: "not_migrated",
          password_reset: "not_migrated"
        },
        business_modules: "not_migrated",
        ai_modules: "not_migrated",
        document_modules: "not_migrated",
        queues: "binding_configured",
        production_cutover: false,
        next_phase: "authentication_testing_and_mfa"
      },
      "Migration status retrieved",
      200,
      requestId
    );
  }

  // --------------------------------------------------
  // LOGIN ROUTE
  //
  // IMPORTANT:
  // This must appear before the generic auth handler.
  // --------------------------------------------------

  if (
    method === "POST" &&
    path === "/api/v1/auth/register"
  ) {
    const registerResponse = await handleRegisterRoute(
      request,
      env,
      requestId
    );

    if (registerResponse) {
      return registerResponse;
    }
  }

  if (
    method === "POST" &&
    path === "/api/v1/auth/login"
  ) {
    const loginResponse = await handleLoginRoute(
      request,
      env,
      requestId
    );

    if (loginResponse) {
      return loginResponse;
    }
  }
  if (
    method === "POST" &&
    path === "/api/v1/auth/mfa/verify-login"
  ) {
    const mfaResponse = await handleMfaLoginRoute(
      request,
      env,
      requestId
    );

    if (mfaResponse) return mfaResponse;
  }
  // --------------------------------------------------
  // Remaining authentication routes
  // --------------------------------------------------

  if (
    path.startsWith("/api/v1/auth/") ||
    path === "/api/v1/me"
  ) {
    const authResponse = await handleAuthRoute(
      request,
      env,
      requestId
    );

    if (authResponse) {
      return authResponse;
    }

    return failure(
      "AUTH_ROUTE_NOT_FOUND",
      "Authentication endpoint not found",
      404,
      requestId
    );
  }

  // --------------------------------------------------
  // Queue test endpoint
  // --------------------------------------------------

  // --------------------------------------------------
  // Core product routes: profile, dashboard, opportunities,
  // proposals, approvals
  // --------------------------------------------------

  const applyResponse = await handleApplyRoute(
    request,
    env,
    requestId
  );

  if (applyResponse) {
    return applyResponse;
  }

  const coreResponse = await handleCoreRoute(
    request,
    env,
    requestId
  );

  if (coreResponse) {
    return coreResponse;
  }

  const workflowResponse = await handleWorkflowRoute(
    request,
    env,
    requestId
  );

  if (workflowResponse) {
    return workflowResponse;
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

  // --------------------------------------------------
  // Not found
  // --------------------------------------------------

  return notFound(path, requestId);
}

// ----------------------------------------------------
// Cloudflare Worker entry point
// ----------------------------------------------------

export default {
  // Cron Trigger: the AI looks for new work and drafts proposals
  // for the best matches. Nothing is ever sent without approval.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runScheduledDiscovery(env));
    ctx.waitUntil(runScheduledReplySync(env));
  },

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
