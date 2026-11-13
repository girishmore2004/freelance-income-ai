# Environment and API key reference

This reference covers every application setting in `backend/app/core.py`, frontend build settings, CI-only values, and optional integrations. Never commit `.env`, provider credentials, database URLs, Redis passwords, OAuth secrets, or backups.

## 1. Core backend settings

| Variable | Required? | Default / example | Purpose |
|---|---|---|---|
| `APP_NAME` | No | `Freelance Income AI` | API title. |
| `ENVIRONMENT` | Yes in production | `development` locally; `production` in hosting | Enables production validation and production-safe behavior. |
| `SECRET_KEY` | Yes | Generate a unique 48-byte URL-safe secret | Signs authentication tokens. Preserve across deploys; rotating it invalidates existing tokens. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `720` | Login token lifetime in minutes. |
| `DATABASE_URL` | Yes | Local Docker URL in `.env.example` | PostgreSQL connection using `postgresql+psycopg://...`. Production migration chain requires PostgreSQL with the `vector` extension. |
| `CORS_ORIGINS` | Yes in production | Exact frontend origin(s), comma-separated | Browser origins permitted to call the API. Never use `*` in production. |
| `FRONTEND_URL` | Yes in production | Exact HTTPS frontend origin | Canonical browser origin; must also appear in `CORS_ORIGINS`. |
| `PUBLIC_REGISTRATION` | Yes to decide | `true` for first registration, then `false` | Disable after creating the owner account. |
| `UPLOAD_MAX_MB` | No | `10` | Maximum upload size. Current document extraction supports PDF/TXT/MD; scanned OCR is not bundled. |
| `RSS_ALLOWED_DOMAINS` | Recommended | Empty or comma-separated hostnames | Restricts RSS/JSON feed domains according to connector validation. |
| `MAX_RSS_ITEMS_PER_FEED` | No | `30` | Discovery feed item cap. |

## 2. AI and retrieval settings

| Variable | Required? | Default / example | Purpose |
|---|---|---|---|
| `AI_PROVIDER` | Yes | `ollama` or `openai` | Text generation provider. |
| `OLLAMA_BASE_URL` | If either provider uses Ollama | Local: `http://host.docker.internal:11434` | Reachable Ollama server. Never use localhost in a cloud container. |
| `OLLAMA_MODEL` | If `AI_PROVIDER=ollama` | `qwen2.5:3b` | Model already pulled on that Ollama server. |
| `OPENAI_API_KEY` | If generation or embeddings use OpenAI-compatible provider | Empty by default | Server-side API credential. OpenAI usage can cost money. |
| `OPENAI_MODEL` | If `AI_PROVIDER=openai` | `gpt-4o-mini` | Exact model identifier enabled by your provider. |
| `OPENAI_BASE_URL` | Optional | Empty | Optional OpenAI-compatible API base URL. Provider must support the chat-completions interface used by this application. |
| `EMBEDDING_PROVIDER` | Yes | `ollama`, `openai` or `lexical` | Embedding provider. `lexical` disables remote embeddings and uses the app's lexical fallback; semantic recall may be lower. |
| `OLLAMA_EMBEDDING_MODEL` | If Ollama embeddings | `nomic-embed-text` | Embedding model already pulled on the Ollama server. |
| `OPENAI_EMBEDDING_MODEL` | If OpenAI embeddings | `text-embedding-3-small` | Embedding model supported by the configured provider. |
| `RETRIEVAL_BACKEND` | No | `auto` | Retrieval backend selection. |
| `RETRIEVAL_TOP_K` | No | `6` | Maximum retrieved chunks. |
| `RETRIEVAL_MIN_SCORE` | No | `0.12` | Retrieval similarity threshold. |
| `RETRIEVAL_CANDIDATE_LIMIT` | No | `1000` | Candidate cap for retrieval. |
| `AI_QUOTA_DAILY_CALLS` | No | `20` | Per-account daily AI quota. |
| `AI_QUOTA_MONTHLY_CALLS` | No | `300` | Per-account monthly AI quota. |

**Free AI guidance:** Ollama and open-weight models can be used without a per-token API bill when run on hardware you control. They are not hosted by Render or Vercel. A cloud API container cannot reach your laptop's `localhost`. For cloud inference, use a secured reachable inference host or an OpenAI-compatible provider; verify its current free quota, model access, terms, and embedding support. Do not assume free inference is unlimited or production-grade. If embeddings are unavailable, retrieval may use its supported lexical fallback, but validate quality with the included evaluation scripts.

## 3. Redis, queue and rate limits

| Variable | Required? | Default / example | Purpose |
|---|---|---|---|
| `REDIS_URL` | Required for production readiness, rate limiting and RQ | `redis://redis:6379/0` locally | Redis TCP connection URL shared by API and worker. Use `rediss://` when the provider requires TLS. |
| `RATE_LIMIT_API_PER_MINUTE` | No | `120` | General API limit. |
| `RATE_LIMIT_AUTH_PER_MINUTE` | No | `10` | Authentication endpoint limit. |
| `RATE_LIMIT_AI_PER_MINUTE` | No | `30` | AI endpoint limit. |

For Upstash, use the **Redis TCP connection URL** for `REDIS_URL`, not the HTTPS REST URL. RQ needs blocking Redis queue operations; Upstash's REST interface does not support `BLPOP`/`BRPOP`, while its native Redis protocol exposes the Redis command interface. Test enqueue/dequeue with your actual provider before enabling background jobs.

## 4. Encryption and optional integrations

| Variable | Required? | When to configure |
|---|---|---|
| `OAUTH_ENCRYPTION_KEY` | Required if Google, Microsoft or Upwork OAuth credentials are configured | Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Preserve the exact key; rotating it makes stored encrypted credentials unreadable. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | Only for Gmail/Google email OAuth. |
| `GOOGLE_REDIRECT_URI` | Optional | Must exactly match the Google OAuth console callback, e.g. `https://API_HOST/api/v1/email-integrations/callback/google`. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Optional | Only for Microsoft email OAuth. |
| `MICROSOFT_TENANT_ID` | Optional | Defaults to `common`; use the tenant configured in Entra. |
| `MICROSOFT_REDIRECT_URI` | Optional | Must exactly match the registered callback. |
| `UPWORK_CLIENT_ID` / `UPWORK_CLIENT_SECRET` | Optional | Only after Upwork grants API access. |
| `UPWORK_REDIRECT_URI` | Optional | Must exactly match the approved Upwork OAuth callback and use HTTPS in production. |
| `UPWORK_SCOPES` | Optional | Only scopes explicitly approved for the app. Do not guess scopes. |
| `UPWORK_CACHE_RETENTION_ENABLED` | Optional | Keep `false` until scheduled cache cleanup is deployed and tested. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional | Telegram notification test/integration. Create a bot with BotFather. |
| `N8N_WEBHOOK_SECRET` | Optional | Random shared secret for the n8n webhook integration. |

The app can be used without Gmail, Microsoft, Upwork, Telegram or n8n credentials. Manual opportunity entry and RSS feeds do not require marketplace API approval. Marketplace API access is controlled by each provider; this repository does not create or guarantee access.

## 5. Frontend settings

Create `frontend/.env.local` for local development from `frontend/.env.example`.

| Variable | Required? | Example | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Required for deployed frontend builds | `https://YOUR-API-HOST` | Public API origin compiled into the browser bundle. HTTPS only in production; no trailing slash. It is not a secret. |
| `PLAYWRIGHT_BASE_URL` | Optional for browser tests | `http://127.0.0.1:3000` | Target a running test deployment instead of launching the local Next.js server. |

Never put backend credentials in `NEXT_PUBLIC_*` variables.

## 6. CI and operational-only settings

These are not normal application secrets. Configure only in the workflow or operational shell that needs them:

- `TEST_DATABASE_URL`: isolated test PostgreSQL URL; never use as production URL.
- `TEST_REDIS_URL`: isolated test Redis database.
- `PRODUCTION_DATABASE_URL`: GitHub Actions secret used only by the optional scheduled Upwork workflow.
- GitHub Actions secrets `OAUTH_ENCRYPTION_KEY`, `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`, `UPWORK_REDIRECT_URI`, `UPWORK_SCOPES`; only if the Upwork integration has approved credentials.
- GitHub Actions variable `UPWORK_CACHE_RETENTION_ENABLED`: leave false until the retention workflow has been validated.
- `APPLY_MIGRATIONS=YES`: explicit one-time operational switch for `ops/deploy_preflight.sh`; never set globally on the API/worker services.
- `PORT`: assigned by the hosting platform; do not hard-code a public port in production.

## 7. Generate secrets

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Use separate unique values for `SECRET_KEY` and `OAUTH_ENCRYPTION_KEY`. Store them in the hosting provider's secret manager. Keep a secure offline copy. Do not paste secrets into GitHub issues, commits, screenshots or chat logs.


## Free hosted inference example (Groq)

The backend uses the OpenAI SDK for its chat-completion path. Groq documents an OpenAI-compatible chat-completions endpoint. If the account's free plan is available to you, use the exact model ID shown in your Groq console:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=YOUR_GROQ_API_KEY
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=MODEL_ID_FROM_GROQ_CONSOLE
EMBEDDING_PROVIDER=lexical
```

This only provides chat generation. It does not provide embeddings through this configuration. `lexical` avoids an embedding API call but reduces semantic retrieval quality. Groq model availability and rate limits vary by model/account; expect 429 responses when limits are reached.


## v5.42 production diagnostics and launch controls

| Variable | Required? | Purpose |
|---|---|---|
| `DIAGNOSTICS_API_KEY` | Optional, strongly recommended for operators | Unique random 32+ character key required by `X-Diagnostics-Key` to call `/api/v1/system/diagnostics`. Never expose to frontend/browser JavaScript. |
| `PUBLIC_REGISTRATION` | Explicit decision | Code default is now `false`; set `true` temporarily only to create the first account, then set `false`. |

Generate a diagnostics key using:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Call diagnostics from a trusted terminal:

```bash
curl -fsS -H "X-Diagnostics-Key: $DIAGNOSTICS_API_KEY" \
  https://YOUR-API-HOST/api/v1/system/diagnostics
```

The diagnostics response contains service status and queue counts but never provider keys, passwords, database URLs, Redis URLs or OAuth secrets. It is protected by the dedicated header key, not by ordinary user authentication. Keep the key in a password manager and rotate it if exposed.


## Account security and transactional email (v5.43.0)

Production must set `REQUIRE_EMAIL_VERIFICATION=true`, `PUBLIC_APP_URL` to the deployed HTTPS frontend origin, and a working SMTP sender. The production configuration check rejects disabled verification or incomplete SMTP configuration.

| Variable | Production setting |
|---|---|
| `REQUIRE_EMAIL_VERIFICATION` | `true` |
| `PUBLIC_APP_URL` | `https://YOUR-VERCEL-DOMAIN` |
| `SMTP_HOST` | Provider SMTP hostname |
| `SMTP_PORT` | `587` for STARTTLS or `465` for implicit TLS |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | Provider-issued SMTP credentials; both or neither |
| `SMTP_FROM_EMAIL` | Verified sender address at your provider |
| `SMTP_FROM_NAME` | `Freelance Income AI` |
| `SMTP_USE_SSL` | `false` for 587; `true` for 465 |

SMTP providers you can evaluate include Brevo SMTP, Resend SMTP and Gmail SMTP with a Google App Password (requires 2-Step Verification). Free-tier limits, sender verification and domain requirements vary and can change; check the provider's current terms before relying on it. Never use your normal Gmail password. For a custom domain, publish the provider's SPF/DKIM records and configure DMARC.

Example for a STARTTLS provider:

```env
REQUIRE_EMAIL_VERIFICATION=true
PUBLIC_APP_URL=https://YOUR-VERCEL-DOMAIN
SMTP_HOST=smtp-relay.example-provider.com
SMTP_PORT=587
SMTP_USERNAME=YOUR_PROVIDER_SMTP_USERNAME
SMTP_PASSWORD=YOUR_PROVIDER_SMTP_PASSWORD
SMTP_FROM_EMAIL=verified-sender@your-domain.example
SMTP_FROM_NAME=Freelance Income AI
SMTP_USE_SSL=false
```

For initial account onboarding, temporarily set `PUBLIC_REGISTRATION=true`, deploy, create and verify your account, then set `PUBLIC_REGISTRATION=false` and redeploy. Keep verification enabled. SMTP credentials belong only in the backend service environment, never in Vercel `NEXT_PUBLIC_*` variables.

**Session migration:** v5.43 access tokens are backed by `auth_sessions` and contain a `jti`. Tokens issued before v5.43 do not have a database session record; users must sign in again after deploying this release. Password reset revokes all sessions. Password reset links expire after 30 minutes; email verification links expire after 24 hours.


## v5.44 authentication hardening variables

| Variable | Default | Purpose |
|---|---:|---|
| `LOGIN_FAILURE_LIMIT` | `8` | Failed password attempts before temporary lockout |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration |
| `MFA_CHALLENGE_MINUTES` | `5` | Lifetime of database-backed MFA login challenge |
| `MFA_CHALLENGE_MAX_ATTEMPTS` | `5` | Failed MFA attempts before challenge is consumed |

TOTP does not require an external API key. Users need a standard authenticator app. MFA is opt-in per account. The TOTP secret is encrypted using a purpose-derived key from `SECRET_KEY`; do not rotate `SECRET_KEY` without a planned recovery procedure.
