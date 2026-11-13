# Upgrade 4.4.0 → 4.5.0

## Scope
This release closes deployment configuration gaps while preserving the existing FastAPI, Next.js, PostgreSQL, Redis/RQ and LangGraph architecture.

## Changes
- Docker API image no longer runs Alembic migrations on every process start.
- Docker Compose now runs a one-shot migration service and starts API/worker only after successful migration and Redis health.
- API container has a readiness health check; web waits for API readiness.
- Worker explicitly pings Redis at startup and fails fast with a clear configuration message.
- Production configuration now rejects localhost Ollama endpoints and invalid/missing provider configuration for cloud deployment.
- Frontend production build can validate that `NEXT_PUBLIC_API_URL` is a valid HTTPS origin.
- CI validates a production API origin and builds with it.
- Added a complete Vercel + Render deployment guide, deployment preflight script and Docker context ignore files.
- Added production configuration regression tests.

## Upgrade
1. Back up repository and production database.
2. Extract/merge over the existing repository, preserving `.git`, `.env` and deployment settings.
3. No schema migration or new production dependency is introduced.
4. For Docker Compose, run `docker compose config` and then `docker compose up --build -d`. Compose now owns the one-time migration service.
5. For Render, run Alembic once as a pre-deploy/release command, then start API with Uvicorn and deploy the worker separately.
6. Set `NEXT_PUBLIC_API_URL` to the production HTTPS API origin in Vercel and redeploy the frontend.
7. Set `OLLAMA_BASE_URL` to a privately reachable cloud Ollama endpoint or select OpenAI with a server-side key. Do not use localhost Ollama in cloud.

## Safety
The deployment preflight does not print secret values. It checks production configuration, Python dependency consistency and migration head count. It applies migrations only when `APPLY_MIGRATIONS=YES` is explicitly supplied. No client email, marketplace submission, deliverable transfer or payment is triggered by this release.
