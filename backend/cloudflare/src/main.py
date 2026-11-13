
"""Staging API for Freelance Income AI on Cloudflare Workers.

This service verifies Worker deployment and PostgreSQL connectivity
through the configured Cloudflare Hyperdrive binding.
"""

import logging
from fastapi import FastAPI, HTTPException, Request
from workers import asgi
import asyncpg

logger = logging.getLogger("freelance-income-ai-api")

app = FastAPI(
    title="Freelance Income AI API",
    description="Backend staging and infrastructure verification API",
    version="0.2.0",
)


@app.get("/")
async def root():
    return {
        "application": "Freelance Income AI",
        "service": "cloudflare-api-staging",
        "status": "operational",
        "production_ready": False,
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "freelance-income-ai-api",
    }


@app.get("/api/v1/deployment/check")
async def deployment_check(request: Request):
    env = request.scope.get("env")
    hyperdrive_available = (
        env is not None
        and getattr(env, "HYPERDRIVE", None) is not None
    )

    return {
        "status": "staging",
        "hyperdrive_binding_available": hyperdrive_available,
        "database_query_verified": False,
        "queue_consumer_configured": False,
        "production_ready": False,
    }


@app.get("/api/v1/health/database")
async def database_health(request: Request):
    """Execute SELECT 1 through Cloudflare Hyperdrive."""

    env = request.scope.get("env")
    hyperdrive = (
        getattr(env, "HYPERDRIVE", None)
        if env is not None
        else None
    )

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
            raise RuntimeError("Database health query returned an unexpected result")

        return {
            "status": "healthy",
            "database": "connected",
            "provider": "Neon PostgreSQL",
            "connection": "Cloudflare Hyperdrive",
            "query_test": "passed",
            "query_result": result,
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception("Hyperdrive database health check failed")
        raise HTTPException(
            status_code=503,
            detail={
                "status": "unhealthy",
                "database": "connection_failed",
                "error_type": type(exc).__name__,
                "message": "Database connectivity test failed. Check Cloudflare Hyperdrive settings and deployment logs.",
            },
        ) from exc

    finally:
        if connection is not None:
            try:
                await connection.close()
            except Exception:
                logger.exception("Failed to close database connection")


Default = asgi.entrypoint(app)
