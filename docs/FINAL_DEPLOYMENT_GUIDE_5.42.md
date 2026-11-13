# Final deployment guide — Freelance Income AI v5.41.0

This is a deployment runbook for the existing monorepo. It does not create marketplace API access, provide free hosted inference, or make a free-tier deployment production-grade. Read the limitations before creating services.

## 0. Choose the operating mode

### A. $0 prototype / personal demo

- Frontend: Vercel Hobby only if your use is personal and non-commercial, or another host whose free-plan terms permit your use.
- API: Render Free Web Service (sleeps after 15 minutes idle; first request after sleep can take about a minute). The 750 free instance-hours are shared across the workspace, so multiple active services can exhaust the allowance sooner.
- Database: Neon Free PostgreSQL. As of this guide's review, Neon publishes 100 CU-hours and 1 GB storage per free project; compute scales to zero. Check the live quota/pricing page before deployment.
- Redis: Upstash Redis Free. Current published free limits include 256 MB data, 10 GB monthly bandwidth and 500,000 monthly commands; check the live dashboard.
- Worker: run `python worker.py` on your own computer while it is on, or omit queued workflows. Render Background Workers do not have a Free compute plan.
- AI generation: optional Groq Free API through the OpenAI-compatible API setting, subject to model-specific rate limits; or run Ollama locally for local development.
- Embeddings: `EMBEDDING_PROVIDER=lexical` keeps retrieval functional without an embedding API. Retrieval falls back to lexical matching.

This mode is not always-on. A sleeping API, a local worker that is powered off, and free quotas can interrupt discovery and background work.

### B. Commercial / client-facing use

Do not assume the $0 prototype stack is suitable for commercial workloads:
- Vercel Hobby is restricted to personal/non-commercial use. Use a plan that permits commercial use or a different host whose terms permit your activity.
- Render Free services are documented for testing/hobby use, sleep on inactivity and have no persistent filesystem. Render may suspend free services that initiate unusually high outbound traffic. Render Free Postgres expires after 30 days; do not store production data there.
- Render does not offer a free background-worker compute plan.
- Use paid/appropriate compute, persistent managed PostgreSQL, a persistent Redis service, backups and monitoring for client data or business-critical operation.

Provider pricing and eligibility change. Re-check provider terms before deployment.

## 1. Prepare the release

1. Download and extract `freelance-income-ai-v5.41.0.zip`.
2. Open the extracted `freelance-income-ai-5.41.0` folder. This folder is the Git repository root.
3. Confirm `VERSION` contains `5.41.0`.
4. Confirm `.env.example` exists and `.env` does not exist in the release folder.
5. Never put real keys, OAuth tokens, database dumps, backups or customer documents in GitHub.
6. Generate a strong backend secret locally:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

7. If enabling Google/Microsoft/Upwork OAuth, generate one Fernet key and preserve it securely across deployments:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

Do not rotate `OAUTH_ENCRYPTION_KEY` casually: previously encrypted provider tokens will no longer decrypt. Rotating `SECRET_KEY` invalidates existing JWT sessions.

## 2. Push to GitHub

Create an empty private GitHub repository (recommended while the app is still being tested).

From the extracted repository root:

```bash
git init
git add .
git status
```

Before committing, verify `.env`, `.env.*` (except `.env.example`), backups, database files, `.venv`, `node_modules`, `.next`, and customer documents are not staged.

```bash
git commit -m "Release Freelance Income AI v5.41.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/freelance-income-ai.git
git push -u origin main
```

If you already have a GitHub repository, do not blindly run `git init` or overwrite the remote. Update the existing working tree, inspect `git diff`, then commit and push.

## 3. Create managed PostgreSQL

1. Create a Neon PostgreSQL project (or another managed PostgreSQL provider that supports the required `vector` extension).
2. Neon supports pgvector; enable the `vector` extension if the migration chain requests it:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. Copy the provider's connection string. Convert only the scheme to SQLAlchemy's psycopg driver form:

   ```text
   postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require
   ```

4. Keep the provider's SSL/query parameters. Do not put the URL in source code.
5. Save it as `DATABASE_URL` in the API and worker environments.
6. Use a paid/persistent plan for production. Do not use Render Free Postgres for durable production data: its documented free database lifetime is 30 days.

## 4. Create Redis

For a low-volume prototype, create an Upstash Redis database and copy its TLS connection string, usually `rediss://...`.

Set the exact same `REDIS_URL` on:
- API service
- Background worker

The application uses Redis for RQ jobs and production rate-limit counters. If Redis is unavailable, production rate-limited API routes can fail closed. Upstash free quotas are finite; watch command count, bandwidth and storage. Use the **native Redis TCP/TLS URL** (`rediss://...`) rather than the HTTPS REST URL: Upstash documents that REST does not support blocking `BLPOP`/`BRPOP` commands used by queue workers. Test a real RQ enqueue/dequeue before depending on it. See [Upstash Redis compatibility](https://upstash.com/docs/redis/overall/compatibility) and [REST command limitations](https://upstash.com/docs/redis/features/restapi).

## 5. Configure AI with minimal cost

### Option 1 — Groq Free API (cloud generation, no embedding spend)

The app uses the OpenAI Python SDK for its `AI_PROVIDER=openai` branch. Groq exposes an OpenAI-compatible Chat Completions endpoint.

Set these on the backend API and worker:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=YOUR_GROQ_API_KEY
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=MODEL_ID_AVAILABLE_IN_YOUR_GROQ_CONSOLE
EMBEDDING_PROVIDER=lexical
```

- Create your key in the Groq console; do not expose it in frontend variables.
- Select a currently available chat model ID from the Groq console. Model availability and free-tier limits vary; 429 responses are possible.
- `OPENAI_API_KEY` is the setting name expected by this code. In this mode, its value is your Groq API key.
- Groq compatibility here is for chat completion generation. Do not assume it provides the app's embeddings endpoint.
- `EMBEDDING_PROVIDER=lexical` explicitly uses lexical retrieval and does not call an embedding API.

### Option 2 — Local Ollama (no per-token API bill)

Install Ollama on a machine you control and pull models:

```bash
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```

Local `.env`:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

For Docker Desktop, use `http://host.docker.internal:11434` from containers. This is a local-development setup. A Render container cannot reach your laptop's `localhost`. Never expose an unauthenticated Ollama server to the public internet. To use Ollama in cloud, provision a private, secured, network-reachable inference host and set its private URL.

### Option 3 — OpenAI API

Set `AI_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` and `OPENAI_EMBEDDING_MODEL`. OpenAI API usage is billed separately from a ChatGPT subscription; it is not a guaranteed free service.

## 5A. API and integration cost guide

| Integration | Free route | Key / approval | What remains limited |
|---|---|---|---|
| RSS/Atom feeds | Public feeds | Usually no key | Source terms, feed availability and rate limits |
| Public JSON feeds | Public API endpoints | Depends on provider | Provider quotas/terms |
| AI chat | Groq Free tier via OpenAI-compatible URL | Groq API key | Model-specific RPM/TPM/RPD limits; may return 429 |
| AI chat local | Ollama on your own machine | No API key | Your hardware, power and network; cloud API cannot reach laptop localhost |
| Embeddings | `EMBEDDING_PROVIDER=lexical` | No key | Lexical matching is less semantic than vector embeddings |
| Embeddings local | Ollama + `nomic-embed-text` | No API key | Local machine availability |
| OpenAI chat/embeddings | OpenAI API | OpenAI API key | Usage is billed separately; not a ChatGPT subscription benefit |
| Notifications | Telegram Bot API | Bot token from BotFather | Telegram delivery and chat configuration |
| Automation | Self-hosted n8n | Shared `N8N_WEBHOOK_SECRET` | Your own hosting/uptime and secure webhook handling |
| Gmail / Outlook | Google Cloud / Microsoft Entra OAuth apps | Client ID/secret, redirect URI, encryption key and user consent | Provider quotas, verification/tenant consent requirements; no automatic background push sync guarantee |
| Upwork | Official API only | Provider-issued client ID/secret and approved scopes | Access approval and permitted scopes; no scraping workaround |
| Freelancer / Fiverr / LinkedIn / Contra / PeoplePerHour | No live connector in this release | Provider-specific official access would be required | Do not assume APIs are public or available |

No API key is needed for manual opportunity entry. Do not buy a key or paste secrets into the browser. For this free-first hosted prototype, the suggested settings are Groq chat + lexical retrieval + Neon Postgres + Upstash Redis, with the worker run locally.

## 6. Deploy the FastAPI backend on Render

Create a Web Service connected to the GitHub repository:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3.12.10 (pinned by `backend/.python-version`) |
| Build Command | `pip install --upgrade pip && pip install -r requirements.txt` |
| Pre-Deploy Command | `alembic upgrade head` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/ready` |

Run migrations once as a controlled release step. On a paid Render plan, use the pre-deploy command. On Render Free, Dashboard shell/one-off jobs are not available; run the migration from your trusted local machine using the production `DATABASE_URL` after installing backend requirements:

```bash
cd backend
python -m pip install -r requirements.txt
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require'
alembic upgrade head
unset DATABASE_URL
```

Use the exact same production database URL configured in Render, double-check the target database before executing, and never run migrations concurrently from multiple API replicas. On Windows PowerShell, replace the `export`/`unset` lines with `$env:DATABASE_URL = '...'` and `Remove-Item Env:DATABASE_URL`. Use the provider's direct PostgreSQL URL for DDL if a pooled URL rejects migration locks/DDL. Back up the database first, then run `alembic current` and confirm the head is `0043_archive_bundle_and_supersession`.

### Backend environment variables

Required for a hosted production API:

| Variable | Value / guidance |
|---|---|
| `APP_NAME` | `Freelance Income AI` |
| `ENVIRONMENT` | `production` |
| `SECRET_KEY` | Unique random value from step 1; 32+ characters |
| `DATABASE_URL` | Managed PostgreSQL URL using `postgresql+psycopg://` |
| `REDIS_URL` | Same Upstash/managed Redis URL used by worker |
| `FRONTEND_URL` | Exact deployed frontend HTTPS origin, no path |
| `CORS_ORIGINS` | Exact frontend HTTPS origin; comma-separated only for additional approved origins |
| `PUBLIC_REGISTRATION` | `true` only for first account creation; change to `false` after creating your account |
| `AI_PROVIDER` | `openai` for Groq/OpenAI-compatible chat or `ollama` for reachable private Ollama |
| `EMBEDDING_PROVIDER` | `lexical` for no embedding API; `ollama` or `openai` if configured |
| `RATE_LIMIT_API_PER_MINUTE` | `120` initial default; tune after observing use |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `10` initial default |
| `RATE_LIMIT_AI_PER_MINUTE` | `30` initial default |
| `AI_QUOTA_DAILY_CALLS` | `20` initial per-account quota |
| `AI_QUOTA_MONTHLY_CALLS` | `300` initial per-account quota |

Optional operator-only diagnostics:
```env
DIAGNOSTICS_API_KEY=GENERATE_A_UNIQUE_RANDOM_48_BYTE_URLSAFE_KEY
```
Generate it with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
Keep this key server-side only. It protects `GET /api/v1/system/diagnostics` via the `X-Diagnostics-Key` header.

Set for Groq/OpenAI-compatible generation:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | Groq API key or OpenAI API key |
| `OPENAI_BASE_URL` | `https://api.groq.com/openai/v1` for Groq; leave empty for OpenAI |
| `OPENAI_MODEL` | Model ID currently enabled for your provider |

Set only when using Ollama:

| Variable | Value |
|---|---|
| `OLLAMA_BASE_URL` | Reachable private Ollama URL; never `localhost` on Render |
| `OLLAMA_MODEL` | Model already pulled on that Ollama host |
| `OLLAMA_EMBEDDING_MODEL` | e.g. `nomic-embed-text` |

Optional variables — leave empty unless enabling the feature:

| Feature | Variables |
|---|---|
| RSS restrictions | `RSS_ALLOWED_DOMAINS`, `MAX_RSS_ITEMS_PER_FEED` |
| n8n webhook | `N8N_WEBHOOK_SECRET` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Uploads | `UPLOAD_MAX_MB` |
| Google email OAuth | `OAUTH_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Microsoft email OAuth | `OAUTH_ENCRYPTION_KEY`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` |
| Upwork OAuth/API | `OAUTH_ENCRYPTION_KEY`, `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`, `UPWORK_REDIRECT_URI`, `UPWORK_SCOPES`, `UPWORK_CACHE_RETENTION_ENABLED` |
| Retrieval tuning | `RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_SCORE`, `RETRIEVAL_BACKEND`, `RETRIEVAL_CANDIDATE_LIMIT` |
| JWT expiry | `ACCESS_TOKEN_EXPIRE_MINUTES` |

`PORT` is supplied by the host. `NEXT_PUBLIC_API_URL` belongs only in the frontend build environment. Do not add secrets to any `NEXT_PUBLIC_` variable.

## 7. Background worker

Create a separate Render Background Worker from the same repository:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `pip install --upgrade pip && pip install -r requirements.txt` |
| Start Command | `python worker.py` |

Copy the API's `ENVIRONMENT`, `SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, AI and quota variables into the worker's environment. It must use the same Redis and PostgreSQL services.

Important: Render Background Workers have no Free compute plan. For a $0 prototype, run the worker manually on your own always-on computer with the same backend environment variables. If the worker is off, queued jobs will not be processed. Do not claim scheduled discovery or queued AI workflows are operating until a worker is running and tested.

## 8. Deploy the frontend

### Vercel

1. Import the GitHub repository.
2. Set Root Directory to `frontend`.
3. Framework preset: Next.js. Use Node.js 20.x (`frontend/.nvmrc` and `package.json` engines).
4. Install command: `npm install`.
5. Build command: `npm run build`.
6. Add:

   ```env
   NEXT_PUBLIC_API_URL=https://YOUR-RENDER-API.onrender.com
   ```

7. Deploy. After Vercel gives you the exact origin, set API `FRONTEND_URL` and `CORS_ORIGINS` to that exact `https://...` origin and redeploy the API.

**Commercial-use warning:** Vercel Hobby is restricted to personal/non-commercial use. If this application is used to generate freelance/business income or for clients, use a plan whose terms permit commercial usage or choose a different provider. Check the current terms before deploying.

## 9. Run production preflight and migrations

From the repository root, use the same production environment values that the API will use. Do not paste secrets into shell history on a shared machine.

```bash
cd backend
python -m pip install -r requirements.txt
ENVIRONMENT=production python scripts/production_preflight.py
alembic heads
```

Expected: production preflight reports `valid: true` and Alembic reports exactly one head. Then back up the database and run:

```bash
alembic upgrade head
```

The current release migration is `0043_archive_bundle_and_supersession`. Never run `drop_all`, delete the database, or reset the production database to upgrade.

## 10. First login and smoke tests

1. Wait for API `/health` and `/ready` to return HTTP 200.
2. Open the frontend and create your account while `PUBLIC_REGISTRATION=true`.
3. Immediately set `PUBLIC_REGISTRATION=false` and redeploy the API.
4. Verify login/logout, profile save, opportunity creation, proposal drafting, approval hash invalidation, project/task/deliverable flow, invoice records, archive creation, archive ZIP download and integrity report.
5. Verify the worker processes a harmless queued job. Check worker logs.
6. Test AI generation and retrieval separately. With lexical retrieval, semantic embeddings are intentionally disabled.
7. Confirm CORS errors are absent in browser devtools.
8. Create a database backup and perform a restore rehearsal against a disposable database before importing real customer data.

Commands:

```bash
curl -fsS https://YOUR-API-HOST/health
curl -fsS https://YOUR-API-HOST/ready
```

## 11. GitHub CI and frontend dependency note

The repository includes GitHub Actions workflows for backend PostgreSQL/pgvector + Redis tests, migrations, frontend typecheck/build, browser E2E, dependency audits and release packaging. Require a green Full CI run on the exact commit before treating a release as deployable. Standard runners for public repositories are free; private-repository compute consumes the monthly included GitHub plan allowance and can be billed after it is exhausted. Check the billing page rather than assuming a fixed minutes allowance. Standard runners for public repositories are free; private-repository compute consumes the monthly included GitHub plan allowance and can be billed after it is exhausted. Check the billing page rather than assuming a fixed minutes allowance.

The frontend currently has pinned direct dependencies in `package.json` but no committed `package-lock.json` in this release. CI and deployment use `npm install`, not `npm ci`. Generate and commit a lockfile from a network-enabled development environment when possible, then switch CI/deploy to `npm ci` for reproducible transitive dependencies.

## 12. Known product and security gaps — do not misrepresent as complete

- Email verification, password reset, MFA and session revocation are not implemented; do not open public registration broadly.
- Marketplace connectors are not universal. Manual, RSS/Atom and permitted public JSON intake work; Upwork requires approved API credentials/scopes. Freelancer, Fiverr, LinkedIn, Contra and PeoplePerHour are not represented as live connectors.
- Proposal submission, automated applications, contract acceptance and payment movement are not implemented. Human approval and manual recording remain the boundary.
- Scanned-PDF OCR is not included; uploaded text extraction is not equivalent to OCR.
- Groq/OpenAI/Ollama outputs can be wrong. Verify every proposal, client-risk finding, financial value and generated message.
- Free tiers can sleep, restart, expire, throttle or change terms/quotas. No $0 combination guarantees 24/7 uptime, worker execution, durable backups and commercial permission.
- A recovery rehearsal is a human-recorded checklist; the application does not execute database restore or independently validate backup contents.
- Archive evidence hashes fingerprint reference strings only, not external documents.
- Obtain a security review, tenant-isolation verification, dependency audit, monitoring and tested backup/restore before storing client-sensitive or financial production records.

## 13. Rollback

- Preserve the previous application commit and deployment.
- Back up PostgreSQL before migration.
- Prefer a forward migration fix; do not downgrade a data-bearing schema without reviewing the migration and data-loss implications.
- Restore only into a separate recovery database first; validate records before redirecting production traffic.


## Current provider documentation

Check live limits and terms immediately before deployment:
- Render free services and their limitations: https://render.com/docs/free
- Render background workers: https://render.com/docs/background-workers
- Neon free plan: https://neon.com/pricing
- Upstash Redis pricing/limits: https://upstash.com/pricing/redis
- Vercel Hobby terms: https://vercel.com/legal/terms
- Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Groq OpenAI-compatible API reference: https://console.groq.com/docs/api-reference
- Ollama embedding model: https://ollama.com/library/nomic-embed-text


## v5.42.0 operational checks

- `/health` reports the running API version.
- `/ready` in production requires PostgreSQL connectivity, Redis connectivity, valid production configuration and Alembic head `0043_archive_bundle_and_supersession`.
- Worker publishes an expiring heartbeat in Redis. Multiple worker instances are supported.
- `GET /api/v1/system/diagnostics` requires the server-only `DIAGNOSTICS_API_KEY` sent as `X-Diagnostics-Key`. It reports DB/migration/Redis status, RQ queued/started/failed counts, active worker count/heartbeat age, AI configuration and production preflight errors/warnings.
- The endpoint does not send billable test prompts to OpenAI-compatible providers. For those providers it verifies configuration presence only. Ollama gets a lightweight `/api/tags` probe.
- Do not set `DIAGNOSTICS_API_KEY` as `NEXT_PUBLIC_*`. Rotate it if exposed.
- Application code now defaults `PUBLIC_REGISTRATION=false`; set it to `true` only during initial onboarding, then turn it off. `.env.example` keeps it enabled for local development convenience.
- This release has no database migration. Do not run an unnecessary migration; existing DB head remains `0043_archive_bundle_and_supersession`.
