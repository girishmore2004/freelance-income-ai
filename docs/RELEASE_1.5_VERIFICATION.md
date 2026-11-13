# Release 1.5 — Verification Report

## Passed
- 64 focused backend/unit tests passed across 17 selected test modules.
- The test process used a lightweight temporary `pgvector` SQLAlchemy type stub because the packaging runtime does not have the `pgvector` package installed. This permits ORM imports but does not test PostgreSQL vector operators.
- Python AST parsing passed for all 74 backend Python files.
- TypeScript TSX transpile/syntax diagnostics: 0 for `frontend/app/page.tsx`.
- Migration `0013_communication_intelligence` SQLite upgrade/downgrade smoke test passed.
- SQLAlchemy ORM metadata `create_all` smoke test passed for 27 tables on SQLite, using the temporary pgvector type stub.
- JSON and Docker Compose YAML parsing passed.
- ZIP integrity and SHA-256 manifest verification passed.

## Not verified in this packaging environment
- Full `tsc --noEmit` / Next.js production build: blocked because frontend `node_modules` and React/Node type definitions are not installed. The TSX syntax-only parse is not a substitute for a full typecheck.
- Importing the complete FastAPI application: blocked because `python-jose` is not installed in the packaging runtime. It is declared in `backend/requirements.txt`.
- Full backend/API test suite: not run. The runtime also lacks dependencies including `pgvector`, `python-jose`, `passlib`, `redis` and `langgraph`.
- PostgreSQL migration execution, pgvector similarity queries, Redis/RQ workers, live Ollama/OpenAI calls, Gmail/Outlook OAuth/sync/send and production deployment were not run.

## Test command for a fully provisioned environment
From `backend/` after installing `requirements.txt`:
```bash
pytest -q
```
From `frontend/` after `npm ci` (or `npm install` if no lockfile is present):
```bash
npm run typecheck
npm run build
```

## Deployment caution
Back up PostgreSQL and preserve the v1.4 environment before applying migration 0013. Validate the new inbox and reply-draft behavior on a test account before using real client messages. The release does not automatically send replies or reminders.
