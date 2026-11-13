## Current release guide

The authoritative v5.41.0 deployment sequence, including free-tier constraints and exact environment-variable setup, is [FINAL_DEPLOYMENT_GUIDE_5.41.md](FINAL_DEPLOYMENT_GUIDE_5.41.md). This file remains a detailed operational reference.

# Production deployment guide

This guide deploys the existing application without changing its architecture:

- Frontend: Vercel (Next.js).
- API: Render Web Service (FastAPI).
- Background jobs: a separate Render Background Worker (RQ).
- Database: managed PostgreSQL with pgvector extension support.
- Queue and rate-limit store: managed Redis-compatible service.
- AI: a reachable Ollama service or optional OpenAI API. Ollama on your personal laptop is not reachable from Render by default.

Provider free tiers, quotas, sleeping behaviour, persistence and expiry policies change. Confirm current provider limits before relying on a free plan. The application itself does not require a paid OpenAI key; cloud inference and persistent managed database/Redis hosting may still incur charges.

## 1. Prepare the repository

1. Push the complete release to GitHub.
2. Confirm `backend/Dockerfile`, `backend/requirements.txt`, `frontend/` and `docs/` are present.
3. Do not commit `.env`, database dumps, OAuth tokens, API keys or backups.
4. Create a long random secret locally:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

5. If enabling Google/Microsoft email OAuth, generate a Fernet key:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

## 2. Provision production data services

Create a managed PostgreSQL database and a Redis-compatible service. Use private/internal connection URLs where supported.

The PostgreSQL instance must support the `vector` extension because the migration chain includes pgvector support. Before production, confirm the provider allows the required extension and that your chosen database plan has persistent storage and backups. The worker and API must point to the same database.

Set `DATABASE_URL` to a SQLAlchemy psycopg URL:

```text
postgresql+psycopg://USER:PASSWORD@HOST:5432/DATABASE
```

If the provider gives `postgres://` or `postgresql://`, convert only the scheme to `postgresql+psycopg://`; retain the supplied host, credentials, database and query parameters.

Set `REDIS_URL` to the provider's private Redis URL (`redis://` or `rediss://`). Do not use an in-memory queue in production. API and worker must use the exact same Redis service and database index.

## 3. Deploy the API on Render

Create a Web Service from the GitHub repository:

- Root Directory: `backend`
- Runtime: Python (recommended for the commands below) or Docker with an explicit pre-deploy migration command.
- Health Check Path: `/ready`
- Instance type: choose a plan that does not sleep if you need reliable background work.

For a native Python service:
- Build Command: `pip install --upgrade pip && pip install -r requirements.txt`
- Pre-Deploy Command (recommended): `alembic upgrade head`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

If your Render plan does not provide a pre-deploy command, run `alembic upgrade head` once from a controlled one-off shell/release step before deploying the new API version. Do not let multiple API replicas run migrations concurrently.

If you select Docker instead of the native Python runtime, the image's default command starts Uvicorn only. Configure the same one-time migration as the service's pre-deploy/release command; do not assume the Docker CMD applies migrations.

Set these environment variables on the API service:

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `SECRET_KEY` | Generated random secret, 32+ characters |
| `DATABASE_URL` | Managed PostgreSQL URL using `postgresql+psycopg://` |
| `REDIS_URL` | Managed Redis URL |
| `FRONTEND_URL` | Exact Vercel HTTPS origin, e.g. `https://your-app.vercel.app` |
| `CORS_ORIGINS` | Same exact origin; comma-separated only if more origins are needed |
| `PUBLIC_REGISTRATION` | `true` for first account creation, then change to `false` |
| `AI_PROVIDER` | `ollama` or `openai` |
| `OLLAMA_BASE_URL` | Reachable Ollama endpoint if using Ollama; never localhost in cloud |
| `OLLAMA_MODEL` | Model already installed on that Ollama service |
| `EMBEDDING_PROVIDER` | `ollama` or `openai` |
| `OLLAMA_EMBEDDING_MODEL` | Embedding model already installed on Ollama |
| `OPENAI_API_KEY` | Only when OpenAI generation or embeddings are selected |
| `OPENAI_MODEL` | Configured model name if using OpenAI |
| `OPENAI_EMBEDDING_MODEL` | Configured embedding model if using OpenAI |
| `RATE_LIMIT_API_PER_MINUTE` | `120` (adjust after observing real traffic) |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `10` |
| `RATE_LIMIT_AI_PER_MINUTE` | `30` |
| `AI_QUOTA_DAILY_CALLS` | `20` |
| `AI_QUOTA_MONTHLY_CALLS` | `300` |

Optional OAuth:
- `OAUTH_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI`

OAuth redirect URLs must exactly match the provider console and use the deployed API hostname:

```text
https://YOUR-API-HOST/api/v1/email-integrations/callback/google
https://YOUR-API-HOST/api/v1/email-integrations/callback/microsoft
```

Do not set `NEXT_PUBLIC_` on any secret. Do not paste secrets into GitHub source files.

### AI hosting limitation

The default Ollama URL in local development is not suitable for a cloud API service. `http://localhost:11434` inside Render points to the Render container, not your laptop. Production preflight now rejects localhost Ollama endpoints. Use a privately reachable Ollama deployment with network access restricted to your API, or choose OpenAI and accept its usage charges. Never expose an unauthenticated Ollama port to the public internet.

## 4. Run the worker separately

Create a Render Background Worker from the same repository:

- Root Directory: `backend`
- Build Command: `pip install --upgrade pip && pip install -r requirements.txt`
- Start Command: `python worker.py`

Copy the same `ENVIRONMENT`, `SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, AI provider/model and quota variables from the API service. The worker must connect to the same database and Redis queue as the API. It must not receive a different `REDIS_URL`.

Deploy the API first and wait until `/ready` returns HTTP 200. Then deploy the worker. Verify worker logs show a successful Redis connection and that the worker is listening on `freelance-income-ai`.

## 5. Deploy the frontend on Vercel

Import the same GitHub repository into Vercel:

- Framework: Next.js
- Root Directory: `frontend`
- Build Command: `npm run build`
- Install Command: `npm install`
- Output: leave the Next.js default.

Set this environment variable for Production (and Preview only if Preview has its own API/CORS setup):

```text
NEXT_PUBLIC_API_URL=https://YOUR-API-HOST
```

This value is public and must contain only the API base URL, without a trailing slash. It is compiled into browser JavaScript at build time. Redeploy after changing it.

After the Vercel hostname is known, update API `FRONTEND_URL` and `CORS_ORIGINS` to the exact HTTPS origin, then redeploy the API.

## 6. First-run sequence

1. Check `https://YOUR-API-HOST/health`.
2. Check `https://YOUR-API-HOST/ready`. It must report database and Redis healthy.
3. Open `https://YOUR-VERCEL-HOST`.
4. Create your first account while `PUBLIC_REGISTRATION=true`.
5. Confirm login, profile save, create one manual opportunity, create a proposal draft, and verify approval is required before marking it ready.
6. Confirm worker queue processing with a harmless agent workflow.
7. Change `PUBLIC_REGISTRATION=false` and redeploy API after your account exists.
8. Verify the worker, API, database and frontend after a full redeploy.
9. Configure a backup schedule and complete a restore drill before importing real client or financial data.

## 7. Deployment smoke checks

```bash
curl -fsS https://YOUR-API-HOST/health
curl -fsS https://YOUR-API-HOST/ready
```

`/health` proves the API process responds. `/ready` checks the database and Redis dependencies and is the correct readiness gate.

Run from a trusted machine with production environment variables loaded:

```bash
bash ops/deploy_preflight.sh
```

To apply migrations as part of a planned deployment:

```bash
APPLY_MIGRATIONS=YES bash ops/deploy_preflight.sh
```

Review the target `DATABASE_URL` before running the migration command. Never use a test URL for production and never reset the production database.

## 8. Docker Compose local verification

```bash
cp .env.example .env
# Edit .env and set a unique SECRET_KEY.
docker compose config
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:8000/ready
```

Open `http://localhost:3000`. Local Compose runs a one-shot migration service before the API and worker, preventing the worker from racing the migration step. The API container itself no longer runs migrations automatically on every restart.

## 9. Rollback and recovery

- Take a PostgreSQL backup before applying migrations.
- Keep the previous Git commit/deployment available for application rollback.
- Do not assume database schema rollback is safe. Prefer a forward fix unless the migration explicitly supports downgrade and data loss has been reviewed.
- Use `ops/backup_postgres.sh` and `ops/verify_backup_restore.sh` from the operational runbook. Actual restore must target a disposable database first.
- Retain GitHub CI, audit, k6 and restore evidence with the release.

## 10. External actions and safety

The product remains approval-gated. Deployment does not authorize automatic marketplace submissions, client email sending, deliverable transfer, invoice sending or payment movement. Test these flows using non-production accounts and keep human approval enabled.
