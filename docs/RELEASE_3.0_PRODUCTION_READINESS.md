# Release 3.0 — Production readiness foundation

## What is included

### 1. Human-approved proposal journey regression tests

`backend/tests/test_production_journey_v30.py` exercises the actual FastAPI
routes for:

- Proposal generation using a deterministic test stub (no paid model/API call).
- Requesting approval for a specific proposal fingerprint.
- Editing a proposal and verifying the previous pending approval becomes unusable.
- Rejecting stale approval decisions.
- Ensuring an edited proposal cannot be marked ready without a new approval.
- Approving the revised proposal and marking it ready.
- Ensuring rejected proposals cannot be marked ready.
- Ensuring another user cannot edit a proposal, decide its approval or mark it ready.

The final `mark-ready` state explicitly returns
`external_submission=not_performed`. These tests do not submit anything to a
marketplace or send email.

### 2. Approval transaction safety

Proposal edit, approval request/decision, mark-ready and workflow resume now lock the relevant proposal, approval or workflow rows with SQLAlchemy `FOR UPDATE` where the database supports row locking. This reduces races between an edit and a simultaneous approval/resume. SQLite ignores row-level `FOR UPDATE`; PostgreSQL is the production concurrency target.

### 3. Production configuration guard

`backend/app/services/production_config.py` validates:

- A unique `SECRET_KEY` of at least 32 characters.
- PostgreSQL `DATABASE_URL`.
- Redis `REDIS_URL`.
- HTTPS `FRONTEND_URL`.
- Explicit HTTPS `CORS_ORIGINS`; wildcard and HTTP origins are rejected.
- `OAUTH_ENCRYPTION_KEY` whenever Google or Microsoft email OAuth is configured.

The API calls this validator during startup when `ENVIRONMENT=production`.
Errors mention configuration rules only and do not echo secret values.
Enabled public registration is a warning, not an automatic startup failure.

Run the CLI from `backend/`:

```bash
ENVIRONMENT=production python scripts/production_preflight.py
```

### 4. CI

The full CI workflow now runs the production configuration preflight using
non-secret test values before applying migrations and running backend tests.
Existing PostgreSQL/pgvector, Redis/RQ and frontend build/typecheck jobs remain.

## Upgrade

- No database schema change; no Alembic migration is required.
- Configure the required production environment variables before deploying.
- Run the preflight in the Render API environment or with the same environment
  variable names in a secure deployment check.
- Do not paste production secrets into GitHub source files, logs or chat.

## Verification boundary

The new pure configuration tests can run without application database packages.
The route-level lifecycle tests require the complete `backend/requirements.txt`
environment and the project's configured test database. The full CI workflow is
the intended environment for running them. A passing local compile is not a
substitute for the route-level test result.
