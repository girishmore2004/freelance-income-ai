
"""
Freelance Income AI
Cloudflare Python Worker - Migration Foundation

Part A:
- FastAPI ASGI entrypoint
- Explicit frontend CORS configuration
- Neon PostgreSQL connectivity through Hyperdrive
- Cloudflare Queues producer verification
- Runtime and deployment diagnostics

This is the migration foundation. The original application
routers will be integrated after their dependencies are adapted.
"""

import logging
import uuid

from datetime import datetime, timezone
from typing import Any

import asyncpg

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from workers import asgi


# ------------------------------------------------------------
# LOGGING
# ------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("freelance-income-ai-api")


# ------------------------------------------------------------
# APPLICATION CONFIGURATION
# ------------------------------------------------------------

APP_NAME = "Freelance Income AI"
SERVICE_NAME = "freelance-income-ai-api"
APP_VERSION = "0.4.0"

FRONTEND_ORIGINS = [
    "https://freelance-income-ai.girishmore097.workers.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app = FastAPI(
    title=APP_NAME,
    description="Freelance Income AI Cloudflare migration API",
    version=APP_VERSION,
)


# ------------------------------------------------------------
# CORS
# ------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=[
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
    ],
    expose_headers=[
        "X-Request-ID",
    ],
    max_age=600,
)


# ------------------------------------------------------------
# CLOUDFLARE BINDINGS
# ------------------------------------------------------------

def get_worker_environment(request: Request) -> Any:
    return request.scope.get("env")


def get_hyperdrive_binding(request: Request) -> Any:
    env = get_worker_environment(request)

    if env is None:
        return None

    return getattr(env, "HYPERDRIVE", None)


def get_queue_binding(request: Request) -> Any:
    env = get_worker_environment(request)

    if env is None:
        return None

    return getattr(env, "FREELANCE_JOBS", None)


# ------------------------------------------------------------
# ROOT
# ------------------------------------------------------------

@app.get("/")
async def root():
    return {
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "status": "operational",
        "environment": "cloudflare-migration",
        "migration_phase": "3A",
        "full_application_integrated": False,
        "production_ready": False,
        "endpoints": [
            "/",
            "/health",
            "/api/v1/deployment/check",
            "/api/v1/deployment/info",
            "/api/v1/health/database",
            "/api/v1/queues/test",
        ],
    }


# ------------------------------------------------------------
# HEALTH
# ------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
    }


# ------------------------------------------------------------
# DATABASE CONNECTIVITY
# ------------------------------------------------------------

@app.get("/api/v1/health/database")
async def database_health(request: Request):
    """
    Verify Neon PostgreSQL connectivity through Hyperdrive.

    No database credentials are returned to the client.
    """

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
            raise RuntimeError("Unexpected database test result")

        logger.info("Hyperdrive database test passed")

        return {
            "status": "healthy",
            "database": "connected",
            "provider": "Neon PostgreSQL",
            "connection": "Cloudflare Hyperdrive",
            "query_test": "passed",
            "query_result": result,
        }

    except Exception as exc:
        logger.exception("Hyperdrive database test failed")

        raise HTTPException(
            status_code=503,
            detail={
                "status": "unhealthy",
                "database": "connection_failed",
                "error_type": type(exc).__name__,
                "message": "Database connectivity test failed",
            },
        ) from exc

    finally:
        if connection is not None:
            try:
                await connection.close()
            except Exception:
                logger.exception("Database connection cleanup failed")


# ------------------------------------------------------------
# DEPLOYMENT DIAGNOSTICS
# ------------------------------------------------------------

@app.get("/api/v1/deployment/check")
async def deployment_check(request: Request):
    hyperdrive = get_hyperdrive_binding(request)
    queue = get_queue_binding(request)

    return {
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "status": "migration_foundation",
        "hyperdrive_binding_available": hyperdrive is not None,
        "queue_binding_available": queue is not None,
        "database_query_verified": False,
        "queue_message_published": False,
        "authentication_integrated": False,
        "full_application_integrated": False,
        "production_ready": False,
    }


@app.get("/api/v1/deployment/info")
async def deployment_info():
    return {
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "platform": "Cloudflare Workers",
        "runtime": "Python Workers",
        "database": "Neon PostgreSQL",
        "database_connection": "Cloudflare Hyperdrive",
        "queue": "Cloudflare Queues",
        "migration_phase": "3A",
        "production_ready": False,
    }


# ------------------------------------------------------------
# QUEUE CONNECTIVITY TEST
# ------------------------------------------------------------

@app.post("/api/v1/queues/test")
async def queue_test(request: Request):
    queue = get_queue_binding(request)

    if queue is None:
        raise HTTPException(
            status_code=503,
            detail="FREELANCE_JOBS binding is unavailable",
        )

    job_id = str(uuid.uuid4())

    message = {
        "event_id": job_id,
        "event_type": "infrastructure.health_check",
        "source": SERVICE_NAME,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "payload": {
            "test": True,
            "message": "Cloudflare queue connectivity test",
        },
    }

    try:
        await queue.send(message)

        return {
            "status": "published",
            "queue": "freelance-income-ai-jobs",
            "event_id": job_id,
        }

    except Exception as exc:
        logger.exception("Queue test failed")

        raise HTTPException(
            status_code=503,
            detail={
                "status": "failed",
                "error_type": type(exc).__name__,
                "message": "Queue publishing failed",
            },
        ) from exc


# ------------------------------------------------------------
# CLOUDFLARE ASGI ENTRYPOINT
# ------------------------------------------------------------

Default = asgi.entrypoint(app)
