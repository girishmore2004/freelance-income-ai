# Environment Variables (new or changed in 5.46.0)

Set in Cloudflare → Workers & Pages → *Worker* → Settings → Variables and Secrets. "Secret" = type **Secret** (encrypted, never shown again). Use the **staging** Worker first. Never put secret values in source code.

## Edge API Worker `freelance-income-ai-api-edge`

| Name | Type | Required | Value / where to get it |
|---|---|---|---|
| `OAUTH_ENCRYPTION_KEY` | Secret | Yes (for Gmail) | ≥32 random bytes, base64. Reuse the Python Fernet key if you have one, or generate one (see runbook). Without it Gmail connect returns 503; existing tokens stay readable via the legacy path. |
| `OAUTH_ENCRYPTION_KEY_PREVIOUS` | Secret | Only during rotation | The old key; delete after the cron log shows `previous_or_unknown: 0, legacy: 0`. |
| `JWT_SECRET` | Secret | Existing | Unchanged. Must still equal Python `SECRET_KEY` (sessions and MFA secrets). |
| `EMAIL_PROVIDER` | Variable | For email flows | `resend` |
| `RESEND_API_KEY` | Secret | For email flows | resend.com → API Keys → Create (sending access only). |
| `RESEND_FROM_EMAIL` | Variable | For email flows | An address on a domain verified in Resend → Domains. |
| `RESEND_FROM_NAME` | Variable | Optional | `Freelance Income AI` |
| `PUBLIC_APP_URL` | Variable | For email flows | Frontend URL, e.g. `https://freelance-income-ai.girishmore097.workers.dev` |
| `REQUIRE_EMAIL_VERIFICATION` | Variable | Existing | Keep `false` until Resend works; then `true`. |
| `AUTH_ALLOW_BEARER` | Variable | Optional | `true` (default). Set `false` only after every page uses cookie mode. |
| `AI_QUOTA_DAILY_CALLS` / `AI_QUOTA_MONTHLY_CALLS` | Variable | Optional | Defaults 20 / 300 (same as Python). |
| `AI_GLOBAL_DAILY_BUDGET_USD` | Variable | Recommended | Default `1`. Platform-wide daily cap for estimated AI spend. |
| `AI_COST_INPUT_USD_PER_MTOK` / `AI_COST_OUTPUT_USD_PER_MTOK` | Variable | Recommended | USD per 1M tokens for `WORKERS_AI_MODEL`, from the Cloudflare Workers AI pricing page. Defaults (1 / 3) are placeholders. |
| `AI_BUDGET_ALERT_RATIO` | Variable | Optional | Default `0.8` — logs `ai.budget_threshold` alerts. |
| `FEATURE_FLAGS_OFF` | Variable | Optional | Emergency kill switch, e.g. `ai.generation` or `*`. |
| `APP_VERSION` | Variable (wrangler) | — | `5.46.0` |

Bindings in `wrangler.jsonc` (5.48.0): rate limiters `AUTH_RATE_LIMITER` (namespace 1001, 20/60 s) and `API_RATE_LIMITER` (namespace 1002, 300/60 s) — no dashboard setup needed; queue **consumer** for `freelance-income-ai-jobs` (DLQ `freelance-income-ai-jobs-dlq`).

## Frontend Worker `freelance-income-ai`

| Name | Type | Value |
|---|---|---|
| `EDGE_API_ORIGIN` | Variable (wrangler) | `https://freelance-income-ai-api-edge.girishmore097.workers.dev` |
| `EDGE_API` | Service binding (wrangler) | → `freelance-income-ai-api-edge` |
| `NEXT_PUBLIC_AUTH_MODE` | Build variable | Unset = bearer (current). Pages are migrated; set `cookie` once Full CI is green (both Playwright passes). |
| `NEXT_PUBLIC_API_URL` | Build variable | Unchanged. |

## Python (`backend/app`, not deployed)
No new variables. `OAUTH_ENCRYPTION_KEY` already exists there.

| `PAYMENT_WEBHOOK_SECRET` | Edge API | Secret | Not set yet | HMAC key for webhooks from the live payment provider (after D-2). While unset, `/payments/webhooks/*` answers 404. |
