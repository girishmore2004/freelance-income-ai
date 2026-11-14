
"""
Freelance Income AI - Cloudflare Python Worker API adapter.

This Worker currently exposes deployment, health, Neon/Hyperdrive and queue
smoke-test endpoints. It is NOT yet the full Freelance Income AI application
backend; do not treat this adapter as providing the /api/v1/auth/* routes.

CORS is applied as an outer ASGI wrapper so allowed-origin headers are also
attached to responses created by the outer ASGI error handling layer.
"""

import logging
import uuid

from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from starlette.middleware.cors import CORSMiddleware
from workers import asgi


# ============================================================
# LOGGING AND APPLICATION CONFIGURATION
# ============================================================

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("freelance-income-ai-api")

APP_NAME = "Freelance Income AI"
SERVICE_NAME = "freelance-income-ai-api"
APP_VERSION = "0.3.1"


# ============================================================
# CORS CONFIGURATION
# ============================================================

# Only explicitly trusted browser origins are allowed.
# Never use "*" with credential-enabled requests.

ALLOWED_ORIGINS = [
    "https://freelance-income-ai.girishmore097.workers.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

ALLOWED_METHODS = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
]

ALLOWED_HEADERS = [
    "Accept",
    "Authorization",
    "Content-Type",
    "Origin",
    "X-Requested-With",
]


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title=APP_NAME,
    description=(
        "Cloudflare deployment and infrastructure API for "
        "Freelance Income AI. The full application API is "
        "not mounted in this staging adapter yet."
    ),
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# ============================================================
# CLOUDFLARE BINDING HELPERS
# ============================================================

def get_worker_environment(request: Request) -> Any:
    """Return Cloudflare Worker environment bindings."""
    return request.scope.get("env")


def get_hyperdrive_binding(request: Request) -> Any:
    """Return HYPERDRIVE binding."""
    env = get_worker_environment(request)

    if env is None:
        return None

    return getattr(env, "HYPERDRIVE", None)


def get_queue_binding(request: Request) -> Any:
    """Return FREELANCE_JOBS queue binding."""
    env = get_worker_environment(request)

    if env is None:
        return None

    return getattr(env, "FREELANCE_JOBS", None)


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/", tags=["system"])
async def root():
    return {
        "success": True,
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "status": "operational",
        "environment": "cloudflare-worker",
        "full_application_api_mounted": False,
        "available_endpoints": [
            "/",
            "/health",
            "/ready",
            "/openapi.json",
            "/api/v1/deployment/check",
            "/api/v1/deployment/info",
            "/api/v1/health/database",
            "/api/v1/queues/test",
        ],
    }


# ============================================================
# HEALTH ENDPOINT
# ============================================================

@app.get("/health", tags=["system"])
async def health():
    return {
        "success": True,
        "status": "healthy",
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
    }


@app.get("/ready", tags=["system"])
async def readiness(request: Request):
    """Check binding presence, without executing database or queue operations."""

    return {
        "success": True,
        "status": "ready",
        "hyperdrive_binding_available": (
            get_hyperdrive_binding(request) is not None
        ),
        "queue_binding_available": (
            get_queue_binding(request) is not None
        ),
        "database_query_verified": False,
        "queue_message_published": False,
    }


# ============================================================
# DEPLOYMENT DIAGNOSTICS
# ============================================================

@app.get("/api/v1/deployment/check", tags=["deployment"])
async def deployment_check(request: Request):

    hyperdrive = get_hyperdrive_binding(request)
    queue = get_queue_binding(request)

    return {
        "success": True,
        "status": "staging",
        "application": APP_NAME,
        "hyperdrive_binding_available": hyperdrive is not None,
        "queue_binding_available": queue is not None,
        "database_query_verified": False,
        "queue_message_published": False,
        "production_ready": False,
    }


@app.get("/api/v1/deployment/info", tags=["deployment"])
async def deployment_info():

    return {
        "success": True,
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "platform": "Cloudflare Workers",
        "database_provider": "Neon PostgreSQL",
        "database_connection": "Cloudflare Hyperdrive",
        "background_queue": "Cloudflare Queues",
        "environment": "staging",
        "full_application_api_mounted": False,
        "production_ready": False,
    }


# ============================================================
# NEON POSTGRESQL / HYPERDRIVE HEALTH
# ============================================================

@app.get("/api/v1/health/database", tags=["health"])
async def database_health(request: Request):

    hyperdrive = get_hyperdrive_binding(request)

    if hyperdrive is None:
        raise HTTPException(
            status_code=503,
            detail="Hyperdrive binding is unavailable",
        )

    connection = None

    try:
        connection = await asyncpg.connect(
            host=hyperdrive.host,
            port=int(hyperdrive.port),
            user=hyperdrive.user,
            password=hyperdrive.password,
            database=hyperdrive.database,
            ssl=False,
            timeout=10,
        )

        result = await connection.fetchval("SELECT 1")

        if result != 1:
            raise RuntimeError(
                "Unexpected PostgreSQL health-check result"
            )

        logger.info(
            "PostgreSQL Hyperdrive health check successful"
        )

        return {
            "success": True,
            "status": "healthy",
            "application": APP_NAME,
            "database": "connected",
            "provider": "Neon PostgreSQL",
            "connection": "Cloudflare Hyperdrive",
            "query_test": "passed",
            "query_result": result,
        }

    except HTTPException:
        raise

    except Exception as exc:

        logger.exception(
            "PostgreSQL Hyperdrive health check failed"
        )

        raise HTTPException(
            status_code=503,
            detail={
                "status": "unhealthy",
                "database": "connection_failed",
                "error_type": type(exc).__name__,
                "message": (
                    "PostgreSQL connection test failed. "
                    "Check Hyperdrive configuration and "
                    "Cloudflare deployment logs."
                ),
            },
        ) from exc

    finally:

        if connection is not None:
            try:
                await connection.close()

            except Exception:
                logger.exception(
                    "Database connection cleanup failed"
                )


# ============================================================
# CLOUDFLARE QUEUE TEST
# ============================================================

@app.post("/api/v1/queues/test", tags=["queues"])
async def queue_test(request: Request):

    queue = get_queue_binding(request)

    if queue is None:
        raise HTTPException(
            status_code=503,
            detail="FREELANCE_JOBS queue binding is unavailable",
        )

    job_id = str(uuid.uuid4())

    message = {
        "event_id": job_id,
        "event_type": "infrastructure.health_check",
        "source": SERVICE_NAME,
        "created_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "payload": {
            "message": "Cloudflare Queue connectivity test",
            "test": True,
        },
    }

    try:

        await queue.send(message)

        logger.info(
            "Queue test message published: %s",
            job_id,
        )

        return {
            "success": True,
            "status": "published",
            "application": APP_NAME,
            "queue": "freelance-income-ai-jobs",
            "job_id": job_id,
            "message": "Test message successfully submitted",
        }

    except Exception as exc:

        logger.exception(
            "Cloudflare Queue publishing failed"
        )

        raise HTTPException(
            status_code=503,
            detail={
                "status": "failed",
                "error_type": type(exc).__name__,
                "message": (
                    "Unable to publish queue test message"
                ),
            },
        ) from exc


# ============================================================
# CENTRALIZED CORS
# ============================================================

# Wrap the entire FastAPI application.
# This handles normal responses, FastAPI exceptions and outer errors.
# Valid OPTIONS preflight requests are handled before endpoint execution.

cors_app = CORSMiddleware(
    app=app,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=ALLOWED_METHODS,
    allow_headers=ALLOWED_HEADERS,
    expose_headers=[
        "Content-Disposition",
        "X-Request-ID",
    ],
    max_age=600,
)


# ============================================================
# CLOUDFLARE PYTHON WORKER ENTRYPOINT
# ============================================================

Default = asgi.entrypoint(cors_app)
