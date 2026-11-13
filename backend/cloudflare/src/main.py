
"""Staging FastAPI adapter for Cloudflare Python Workers.

This is a compatibility-check service, not the production application.
It deliberately does not import the existing backend until its
dependencies and infrastructure integrations have been validated.
"""

from fastapi import FastAPI, Request
from workers import asgi


app = FastAPI(
    title="Freelance Income AI API",
    description="Cloudflare backend deployment compatibility check",
    version="0.1.0",
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


Default = asgi.entrypoint(app)
