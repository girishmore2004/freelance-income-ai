# Upgrade 4.1.0 → 4.2.0

## Scope
This release continues the current FastAPI / Next.js / PostgreSQL / Redis / RQ / LangGraph architecture. No database schema migration or new production dependency is added.

## Changes
- Adds Redis/RQ integration tests for a real queued job executed by `SimpleWorker`.
- Adds API integration tests for agent-workflow enqueue, idempotent replay, Redis queue outage and retry after queue availability returns.
- Full CI now passes its isolated Redis service URL into the backend pytest process as both `REDIS_URL` and `TEST_REDIS_URL`.
- Fixes invalid trailing escaped newline characters in `frontend/package.json`; the file is now valid JSON and npm can parse it.
- Updates release metadata to 4.2.0.

## Upgrade steps
1. Back up the repository and database.
2. Merge/extract this ZIP over the existing repository; preserve `.git`, `.env` and deployment configuration.
3. No Alembic migration or new environment variable is required in production.
4. Install backend dependencies and run `cd backend && pytest -q`.
5. Run frontend checks with `cd frontend && npm install && npm run typecheck && npm run build`.
6. Review the GitHub Actions full-CI result. The Redis integration tests require the CI Redis service; they skip when `TEST_REDIS_URL` is absent.
7. Commit and push the reviewed changes.

## Safety
The RQ smoke test executes only a local arithmetic test function. Agent-workflow integration tests enqueue but deliberately do not execute the AI workflow task, so they do not invoke LLMs or external providers. No email, marketplace submission, client handover or payment is performed.
