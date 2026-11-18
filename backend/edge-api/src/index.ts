import type { Env, QueueBatch } from "./types";

import { handleLoginRoute } from "./lib/login-route";
import { handleAuthRoute } from "./lib/auth-routes";
import { handleAccountRoute } from "./lib/account-routes";
import { handleIdentityRoute } from "./lib/identity-routes";
import { handleTeamRoute } from "./lib/team-routes";
import { handleBusinessRoute } from "./lib/business-routes";
import { handleAnalyticsRoute } from "./lib/analytics-routes";
import { handlePlannerRoute } from "./lib/planner-routes";
import { handleOpportunityRoute } from "./lib/opportunity-routes";
import { handleDiscussionRoute } from "./lib/discussion-routes";
import { handleListingFileRoute } from "./lib/listing-file-routes";
import { handleVerificationRoute } from "./lib/verification-routes";
import { handleSourceRoute } from "./lib/source-routes";
import { handleTaskRoute, runWeeklyProgressDigests } from "./lib/task-routes";
import { handleGrowthRoute, runDailyJobDigest } from "./lib/growth-routes";
import { handleStatementRoute } from "./lib/statement-routes";
import { handleProfileRoute } from "./lib/profile-routes";
import { handleOpsRoute } from "./lib/ops-routes";
import { handleSupportRoute } from "./lib/support-routes";
import { handleListingRoute } from "./lib/listing-routes";
import { handleMatchRoute, runScheduledListingExpiry } from "./lib/match-routes";
import { handleHiringRoute } from "./lib/hiring-routes";
import { handleDeliveryRoute } from "./lib/delivery-routes";
import { handleReviewRoute } from "./lib/review-routes";
import { handleFinanceRoute } from "./lib/finance-routes";
import { handlePlanRoute } from "./lib/plan-routes";
import { handleAgentRoute } from "./lib/agents";
import { handleAssistantRoute } from "./lib/assistant-routes";
import { handleTrustRoute } from "./lib/trust-routes";
import { handlePublicRoute } from "./lib/public-routes";
import { handlePaymentRoute } from "./lib/payment-routes";
import { handleNotificationRoute } from "./lib/notify";
import { handleDisputeRoute } from "./lib/dispute-routes";
import { handleFileRoute } from "./lib/file-routes";
import { releasePendingApprovals } from "./lib/payments";
import { enforceRateLimit } from "./lib/rate-limit";
import { applySessionCookies } from "./lib/auth-context";
import { handleMfaLoginRoute } from "./lib/mfa-login-route";
import { handleRegisterRoute } from "./lib/register-route";
import { database, handleCoreRoute } from "./lib/core-routes";
import { handleWorkflowRoute } from "./lib/workflow-routes";
import { handleApplyRoute } from "./lib/apply-routes";
import { runScheduledReplySync, runScheduledTokenMaintenance } from "./lib/apply-agent";
import { runScheduledDiscovery } from "./lib/discovery-agent";
import { handleJobRoute } from "./lib/job-routes";
import { processQueueBatch, runScheduledQueueMaintenance } from "./lib/jobs";
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
  // Throttling (Cloudflare Rate Limiting bindings)
  // --------------------------------------------------

  const limited = await enforceRateLimit(request, env, requestId);

  if (limited) {
    return limited;
  }

  // --------------------------------------------------
  // Root endpoint
  // --------------------------------------------------

  if (method === "GET" && path === "/") {
    return success(
      {
        application: env.APP_NAME ?? "Freelance Income AI",
        service: "freelance-income-ai-api-edge",
        version: env.APP_VERSION ?? "5.46.0",
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
        version: env.APP_VERSION ?? "5.46.0",
        platform: "Cloudflare Workers",
        database: "Neon PostgreSQL",
        database_transport: "Hyperdrive",
        queue_enabled: Boolean(env.FREELANCE_JOBS),
        migration_stage: "phase0_stabilisation",
        authentication: {
          login_route: "implemented",
          session_validation: "implemented",
          logout_routes: "implemented",
          registration: "implemented",
          email_verification: "implemented_requires_resend",
          password_reset: "implemented_requires_resend",
          session_management: "implemented",
          mfa_verification: "implemented",
          mfa_management: "implemented",
          cookie_sessions: "implemented_opt_in"
        },
        queue_consumer: "edge_worker",
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
        phase: 0,
        foundation: "stabilising",
        authentication: "parity_with_python",
        authentication_features: {
          login: "implemented",
          registration: "implemented",
          email_verification: "implemented_requires_resend",
          password_reset: "implemented_requires_resend",
          password_change: "implemented",
          sessions_list_revoke: "implemented",
          mfa_verification: "implemented",
          mfa_setup_enable_disable: "implemented",
          cookie_sessions: "implemented_opt_in"
        },
        business_modules: "partial",
        ai_modules: "partial_with_budget_controls",
        document_modules: "not_migrated",
        queues: "consumer_on_edge_worker",
        production_cutover: false,
        next_phase: "frontend_cookie_migration_and_client_marketplace"
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
  // Account security: email verification, password reset,
  // password change, sessions and MFA management
  // --------------------------------------------------

  const accountResponse = await handleAccountRoute(
    request,
    env,
    requestId
  );

  if (accountResponse) {
    return accountResponse;
  }

  // --------------------------------------------------
  // Identity: roles and organisations (/me/identity, /me/roles,
  // /organizations). Must run before the generic /me handler.
  // --------------------------------------------------

  const businessResponse = await handleBusinessRoute(
    request,
    env,
    requestId
  );

  if (businessResponse) {
    return businessResponse;
  }

  // Analytics (freelancer, client, platform) and staff user management,
  // audit log and system health (U6). GET only.
  const analyticsResponse = await handleAnalyticsRoute(request, env, requestId);
  if (analyticsResponse) {
    return analyticsResponse;
  }

  // Staff operations: finance exceptions, reconciliation, failed jobs (U8).
  const opsResponse = await handleOpsRoute(request, env, requestId);
  if (opsResponse) {
    return opsResponse;
  }

  // External opportunity timeline, follow-ups and interviews (U8).
  const opportunityResponse = await handleOpportunityRoute(request, env, requestId);
  if (opportunityResponse) {
    return opportunityResponse;
  }

  // Proposal discussions, interviews and the unified inbox (U9).
  const discussionResponse = await handleDiscussionRoute(request, env, requestId);
  if (discussionResponse) {
    return discussionResponse;
  }

  // Project reference files, verification queues and source management (U10).
  for (const handler of [handleListingFileRoute, handleVerificationRoute, handleSourceRoute, handleTaskRoute, handleGrowthRoute, handleStatementRoute, handleProfileRoute]) {
    const response = await handler(request, env, requestId);
    if (response) {
      return response;
    }
  }

  // Saved projects, calendar (U7) and support tickets.
  const plannerResponse = await handlePlannerRoute(request, env, requestId);
  if (plannerResponse) {
    return plannerResponse;
  }
  const supportResponse = await handleSupportRoute(request, env, requestId);
  if (supportResponse) {
    return supportResponse;
  }

  const teamResponse = await handleTeamRoute(
    request,
    env,
    requestId
  );

  if (teamResponse) {
    return teamResponse;
  }

  const identityResponse = await handleIdentityRoute(
    request,
    env,
    requestId
  );

  if (identityResponse) {
    return identityResponse;
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

  const notificationResponse = await handleNotificationRoute(
    request,
    env,
    requestId
  );

  if (notificationResponse) {
    return notificationResponse;
  }

  const fileResponse = await handleFileRoute(
    request,
    env,
    requestId
  );

  if (fileResponse) {
    return fileResponse;
  }

  const disputeResponse = await handleDisputeRoute(
    request,
    env,
    requestId
  );

  if (disputeResponse) {
    return disputeResponse;
  }

  const paymentResponse = await handlePaymentRoute(
    request,
    env,
    requestId
  );

  if (paymentResponse) {
    return paymentResponse;
  }

  const publicResponse = await handlePublicRoute(
    request,
    env,
    requestId
  );

  if (publicResponse) {
    return publicResponse;
  }

  const trustResponse = await handleTrustRoute(
    request,
    env,
    requestId
  );

  if (trustResponse) {
    return trustResponse;
  }

  const assistantResponse = await handleAssistantRoute(
    request,
    env,
    requestId
  );

  if (assistantResponse) {
    return assistantResponse;
  }

  const agentResponse = await handleAgentRoute(
    request,
    env,
    requestId
  );

  if (agentResponse) {
    return agentResponse;
  }

  const planResponse = await handlePlanRoute(
    request,
    env,
    requestId
  );

  if (planResponse) {
    return planResponse;
  }

  const financeResponse = await handleFinanceRoute(
    request,
    env,
    requestId
  );

  if (financeResponse) {
    return financeResponse;
  }

  const reviewResponse = await handleReviewRoute(
    request,
    env,
    requestId
  );

  if (reviewResponse) {
    return reviewResponse;
  }

  const deliveryResponse = await handleDeliveryRoute(
    request,
    env,
    requestId
  );

  if (deliveryResponse) {
    return deliveryResponse;
  }

  const hiringResponse = await handleHiringRoute(
    request,
    env,
    requestId
  );

  if (hiringResponse) {
    return hiringResponse;
  }

  const matchResponse = await handleMatchRoute(
    request,
    env,
    requestId
  );

  if (matchResponse) {
    return matchResponse;
  }

  const listingResponse = await handleListingRoute(
    request,
    env,
    requestId
  );

  if (listingResponse) {
    return listingResponse;
  }

  const jobResponse = await handleJobRoute(
    request,
    env,
    requestId
  );

  if (jobResponse) {
    return jobResponse;
  }

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

// Retries payment releases for approved, funded milestones (e.g. after a failure at approval time).
async function runScheduledPaymentReleases(env: Env): Promise<void> {
  const sql = database(env);
  try {
    const released = await releasePendingApprovals(sql);
    if (released) console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "payments.releases_retried", count: released }));
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "payments.release_retry_failed", error: error instanceof Error ? error.message : "unknown" }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** U14/U15: Monday contract progress summaries and the daily external-jobs digest (both deduplicated). */
async function runScheduledProgressDigests(env: Env): Promise<void> {
  if (!env.HYPERDRIVE?.connectionString) return;
  const sql = database(env);
  try {
    const now = new Date();
    const sent = await runWeeklyProgressDigests(sql, now);
    if (sent) console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "progress_digest.sent", contracts: sent }));
    const digests = await runDailyJobDigest(sql, now);
    if (digests) console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "jobs_digest.sent", users: digests }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default {
  // Cron Trigger: the AI looks for new work and drafts proposals
  // for the best matches. Nothing is ever sent without approval.
  // With the queue configured, discovery runs as idempotent per-user
  // queue jobs (with retries and dead-lettering); without it, inline.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    if (env.FREELANCE_JOBS) {
      ctx.waitUntil(runScheduledQueueMaintenance(env));
    } else {
      ctx.waitUntil(runScheduledDiscovery(env));
    }
    ctx.waitUntil(runScheduledReplySync(env));
    ctx.waitUntil(runScheduledTokenMaintenance(env));
    ctx.waitUntil(runScheduledListingExpiry(env));
    ctx.waitUntil(runScheduledPaymentReleases(env));
    ctx.waitUntil(runScheduledProgressDigests(env));
  },

  // Queue consumer for freelance-income-ai-jobs (replaces the separate
  // health-check-only consumer Worker; see DEPLOYMENT_RUNBOOK.md).
  async queue(
    batch: QueueBatch,
    env: Env
  ): Promise<void> {
    await processQueueBatch(batch, env);
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

    response = await applySessionCookies(
      request,
      response,
      env
    );

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
