# Deployment Runbook — release 5.46.0 (Phase 0 batch 1)

Do the steps in order, on **staging** first. Nothing here moves money or sends email until you configure it.

## 0. Before you start
- You need: GitHub access to both repositories, the Cloudflare dashboard (account that owns `*.girishmore097.workers.dev`), the Neon console.
- Wait for both CI workflows to be green after pushing (step 1). If a check fails, stop and fix it first.

## 1. Commit and push (GitHub)
On a computer with both repos cloned (terminal in each repo folder):
```bash
git checkout -b phase0-stabilisation
# copy the changed files into place (exact paths are listed in the delivery note)
git add -A
git commit -m "Phase 0: migrations 0047-0049, Edge auth parity, OAuth key, queue consumer, AI governor"
git push -u origin phase0-stabilisation
```
Then on github.com open each repo → **Pull requests → New** → base `main`, compare `phase0-stabilisation` → Create. Wait for **Full CI** (freelance-income-ai) and **Edge API CI** (freelance-income-ai-api-edge). Merge only when green.

## 2. Back up Neon
console.neon.tech → your project → **Branches** → **Create branch** → name `pre-0047-2026-11`, parent `main` (or the branch the Hyperdrive config points at), "current point in time" → Create. This is your rollback point.

## 3. Migrate the database (GitHub Actions)
`freelance-income-ai` repo → **Actions** → **Stage 3C Neon migrations** → **Run workflow** → type the confirmation text exactly as the form asks → Run. Expected: the summary shows `Expected Alembic revision: 0049_feature_flags_ai_cost` and the job is green.
Verify in Neon → **SQL Editor**: `SELECT version_num FROM alembic_version;` → `0049_feature_flags_ai_cost`.
If it fails with "existing rows contain duplicates": nothing changed; follow DATABASE_MIGRATION_STATUS.md.

## 4. Add secrets/variables to the Edge Worker
Cloudflare dashboard → **Workers & Pages** → `freelance-income-ai-api-edge` → **Settings** → **Variables and Secrets** → **Add**:
- `OAUTH_ENCRYPTION_KEY` — type **Secret**. Generate on your computer: `openssl rand -base64 32` (macOS/Linux terminal; on Windows use Git Bash). Copy the output once into the field; store it in your password manager. If the Python app already has an `OAUTH_ENCRYPTION_KEY`, you may reuse that value instead.
- Optional now, required for email: `EMAIL_PROVIDER`=`resend` (Text), `RESEND_FROM_EMAIL` (Text), `PUBLIC_APP_URL` (Text), `RESEND_API_KEY` (**Secret**, from resend.com → API Keys).
- Recommended: `AI_GLOBAL_DAILY_BUDGET_USD` (Text, e.g. `1`), `AI_COST_INPUT_USD_PER_MTOK` and `AI_COST_OUTPUT_USD_PER_MTOK` (Text, from the Workers AI pricing page for your model).
Click **Deploy/Save**. Keep `REQUIRE_EMAIL_VERIFICATION=false` until a test email arrives.

## 5. Move the queue consumer to the Edge Worker
A queue can have only one consumer, so detach the old one first:
1. Cloudflare → **Storage & Databases → Queues** → confirm `freelance-income-ai-jobs-dlq` exists (create it with that exact name if not).
2. Open `freelance-income-ai-jobs` → **Settings / Consumers** → remove consumer `freelance-income-ai-consumer`. Messages wait safely in the queue meanwhile.
3. Deploy the Edge API (step 6). The deploy registers it as the consumer with the same retry/DLQ settings.
4. Leave the old `freelance-income-ai-consumer` Worker in place (harmless) or delete it after a week.

## 6. Deploy the Edge API
- If the Worker is connected to GitHub (**Settings → Builds** shows the repo): merging the PR deploys it. Watch **Deployments**.
- Otherwise, in `freelance-income-ai-api-edge/backend/edge-api`: `npm install` then `npx wrangler deploy` (expected last line: the workers.dev URL and a version id).

Verify (browser or `curl`):
- `GET https://freelance-income-ai-api-edge.girishmore097.workers.dev/api/v1/deployment/info` → `version: "5.46.0"`, `queue_consumer: "edge_worker"`.
- Sign in on the frontend, then call `POST /api/v1/discovery/refresh` → `202` with a `job_id`; within a minute `GET /api/v1/background-jobs` shows it `succeeded` (or `retrying` with an error message).
- Cloudflare → Worker → **Logs**: look for `queue.job_succeeded`; after the next 6-hour cron, `oauth_token.key_status` and `queue.health`.

## 7. Alerts (Workers Observability)
Worker → **Observability** → create alerts (or saved queries checked daily) on log events with `alert = true`: `queue.health`, `ai.budget_threshold`, `ai.budget_exhausted`, and on `queue.job_dead`, `oauth_token.reencrypt_failed`, `account_mail.failed`. Responder: founder (until D-9).

## 8. Deploy the frontend
The proxy and service binding are additive; bearer mode stays on, so nothing changes for users yet. Deploy as you do today (Workers Builds or `npm run deploy` in `frontend`). Verify `https://freelance-income-ai.girishmore097.workers.dev/api/v1/me` returns 401 JSON (proxy reaches the API).

### Cookie sessions (later, after pages are migrated)
Set build variable `NEXT_PUBLIC_AUTH_MODE=cookie`, redeploy, sign in, and confirm in DevTools → Application → Cookies that `__Host-fia_session` is HttpOnly. When all pages work, set `AUTH_ALLOW_BEARER=false` on the Edge Worker.

## Rollback
- Edge or frontend: Cloudflare → Worker → **Deployments** → previous version → **Rollback**. If you roll the Edge API back, re-attach the old consumer to the queue.
- Database: see DATABASE_MIGRATION_STATUS.md (5.45 code runs on the 0049 schema).
- Kill switches without deploy: set `FEATURE_FLAGS_OFF=ai.generation` (or `*`) on the Edge Worker.
