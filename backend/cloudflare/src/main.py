
"""
Freelance Income AI
Cloudflare Python Worker - Staging API

Features:
- FastAPI application
- Cloudflare Hyperdrive integration
- Neon PostgreSQL connectivity test
- Cloudflare Queues producer
- Deployment and infrastructure health checks

IMPORTANT:
This is the Cloudflare staging adapter.
It does not replace the existing full application backend.
"""

import logging
import uuid

from datetime import datetime, timezone
from typing import Any

import asyncpg

from fastapi import FastAPI, HTTPException, Request
from workers import asgi


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("freelance-income-ai-api")


# ============================================================
# APPLICATION
# ============================================================

APP_NAME = "Freelance Income AI"
SERVICE_NAME = "freelance-income-ai-api"
APP_VERSION = "0.3.0"

app = FastAPI(
    title=APP_NAME,
    description="Cloudflare backend staging and infrastructure API",
    version=APP_VERSION,
)


# ============================================================
# CLOUDFLARE BINDING HELPERS
# ============================================================

def get_worker_environment(request: Request) -> Any:
    """
    Retrieve Cloudflare Worker environment bindings.
    """

    return request.scope.get("env")


def get_hyperdrive_binding(request: Request) -> Any:
    """
    Retrieve the HYPERDRIVE binding.
    """

    env = get_worker_environment(request)

    if env is None:
        return None

    return getattr(env, "HYPERDRIVE", None)


def get_queue_binding(request: Request) -> Any:
    """
    Retrieve the FREELANCE_JOBS queue binding.
    """

    env = get_worker_environment(request)

    if env is None:
        return None

    return getattr(env, "FREELANCE_JOBS", None)


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
async def root():
    """
    Basic application information.
    """

    return {
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "status": "operational",
        "environment": "staging",
        "production_ready": False,
        "available_endpoints": [
            "/",
            "/health",
            "/api/v1/deployment/check",
            "/api/v1/health/database",
            "/api/v1/queues/test",
        ],
    }


# ============================================================
# APPLICATION HEALTH
# ============================================================

@app.get("/health")
async def health():
    """
    Application-level health check.
    """

    return {
        "status": "healthy",
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
    }


# ============================================================
# DEPLOYMENT AND BINDING CHECK
# ============================================================

@app.get("/api/v1/deployment/check")
async def deployment_check(request: Request):
    """
    Check whether Cloudflare infrastructure bindings exist.

    This checks binding availability only.
    It does not execute database or queue operations.
    """

    hyperdrive = get_hyperdrive_binding(request)
    queue = get_queue_binding(request)

    return {
        "status": "staging",
        "application": APP_NAME,
        "hyperdrive_binding_available": hyperdrive is not None,
        "queue_binding_available": queue is not None,
        "database_query_verified": False,
        "queue_message_published": False,
        "production_ready": False,
    }


# ============================================================
# POSTGRESQL / NEON DATABASE HEALTH
# ============================================================

@app.get("/api/v1/health/database")
async def database_health(request: Request):
    """
    Verify PostgreSQL connectivity through Cloudflare Hyperdrive.

    Executes:
        SELECT 1

    Never returns database credentials.
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
            raise RuntimeError(
                "Unexpected PostgreSQL health-check result"
            )

        logger.info("PostgreSQL health check successful")

        return {
            "status": "healthy",
            "application": APP_NAME,
            "database": "connected",
            "provider": "Neon PostgreSQL",
            "connection": "Cloudflare Hyperdrive",
            "query_test": "passed",
            "query_result": result,
        }

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
                    "Check Hyperdrive configuration and deployment logs."
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
# CLOUDFLARE QUEUE PRODUCER TEST
# ============================================================

@app.post("/api/v1/queues/test")
async def queue_test(request: Request):
    """
    Publish a harmless infrastructure test message.

    This endpoint verifies that the backend Worker can publish
    messages to the freelance-income-ai-jobs queue.

    It does not process financial or user-related jobs.
    """

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
                "message": "Unable to publish queue test message",
            },
        ) from exc


# ============================================================
# API INFORMATION
# ============================================================

@app.get("/api/v1/deployment/info")
async def deployment_info():
    """
    Return staging deployment information.
    """

    return {
        "application": APP_NAME,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "platform": "Cloudflare Workers",
        "database_provider": "Neon PostgreSQL",
        "database_connection": "Cloudflare Hyperdrive",
        "background_queue": "Cloudflare Queues",
        "environment": "staging",
        "production_ready": False,
    }


# ============================================================
# CLOUDFLARE ASGI ENTRYPOINT
# ============================================================

Default = asgi.entrypoint(app)
