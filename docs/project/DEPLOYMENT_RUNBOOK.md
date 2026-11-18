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
**Cloudflare build settings (fix for "root directory not found"):** Workers & Pages → `freelance-income-ai-api-edge` → Settings → Build. The Edge API exists only on branch `cloudflare-edge-api-phase1`, so set: Git branch / production branch = `cloudflare-edge-api-phase1`; root directory = `backend/edge-api`; build command = `npm run check`; deploy command = `npx wrangler deploy`; turn off builds for non-production branches (otherwise every push to `main` fails the same way).
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

### Cookie sessions (pages migrated in batch 2)
Prerequisites: Edge API ≥ 5.46.0 deployed; frontend deployed with the `EDGE_API` service binding; Full CI green including "Run browser regression suite in cookie-session mode".
Cloudflare → Workers & Pages → `freelance-income-ai` → Settings → Build → Build variables → add `NEXT_PUBLIC_AUTH_MODE` = `cookie` → Save → redeploy (Deployments → Retry/redeploy latest). Everyone will be signed out once (old tokens are deleted).
Set build variable `NEXT_PUBLIC_AUTH_MODE=cookie`, redeploy, sign in, and confirm in DevTools → Application → Cookies that `__Host-fia_session` is HttpOnly. When all pages work, set `AUTH_ALLOW_BEARER=false` on the Edge Worker.

## Phase 1 (release 5.48.0): roles and client accounts
1. Neon backup branch, then GitHub Actions → "Stage 3C Neon migrations" (expects `0050_identity_roles_orgs`). Check: `SELECT role, count(*) FROM user_roles GROUP BY role;` shows every user as freelancer.
2. Deploy the Edge API (branch `cloudflare-edge-api-phase1`). The build log should list `env.AUTH_RATE_LIMITER` and `env.API_RATE_LIMITER` as Rate Limit bindings.
3. Deploy the frontend (`main`). Open `/account` → "Your roles" shows Find work = Active, Hire = locked.
4. To try the client side on staging only: Neon → SQL Editor → `UPDATE feature_flags SET enabled = true, updated_by = 'founder' WHERE key = 'marketplace.client_side';` Reload `/account` → "Turn on" for Hire → create a client account. Switch off again with `enabled = false` (or set the Worker variable `FEATURE_FLAGS_OFF=marketplace.client_side` for an instant kill switch).

## Phase 2 batch 1 (release 5.49.0): client project posting
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0051_native_project_listings`). Check: `SELECT slug, enabled FROM project_categories;`.
2. Deploy Edge (branch `cloudflare-edge-api-phase1`, 5.49.0), then the frontend (`main`).
3. With `marketplace.client_side` ON (staging): Account → turn on Hire → create a client account → **Manage projects** → Post a new project → describe it → "Draft the brief with AI" → set budget and deadline → Save and submit. It should say "Published" and appear on `/projects` for any signed-in user.
4. Enable more categories (D-6): `UPDATE project_categories SET enabled = true, updated_at = now() WHERE slug = 'ui_ux_design';`
5. Moderation until the admin queue exists — list held listings: `SELECT l.id, v.title, l.moderation_notes FROM project_listings l JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version WHERE l.status = 'in_review';` Approve: `UPDATE project_listings SET status = 'published', moderation_status = 'approved', published_at = COALESCE(published_at, now()), updated_at = now() WHERE id = '<id>' AND status = 'in_review';` Return to the client: `UPDATE project_listings SET status = 'draft', moderation_status = 'rejected', moderation_notes = '<reason>', updated_at = now() WHERE id = '<id>' AND status = 'in_review';`

## Phase 2 batch 2 (release 5.50.0): matching, invitations, saved freelancers, closing dates
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0052_invites_saved_freelancers`). Check: `SELECT count(*) FROM profiles WHERE marketplace_visible;` returns 0 (nobody is visible until they opt in).
2. Deploy Edge (5.50.0), then the frontend. **Run the migration before switching `marketplace.client_side` on**: with the flag on, the marketplace detail and the new routes read `listing_invitations`.
3. Staging check (flag ON): as a freelancer open `/projects` → tick "Show my profile to clients". As a client open `/client/projects` → a published listing → **Find freelancers** → the freelancer appears with a score and reasons → **Invite to propose**. Back as the freelancer, the invitation appears on `/projects` → Accept.
4. Listings with a closing date are marked `expired` by the 6-hourly cron (log event `listings.expired`).

## Phase 3 batch 1 (release 5.51.0): proposals, offers, contracts
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0053_proposals_contracts`). Check: `SELECT count(*) FROM contracts;` returns 0.
2. Deploy Edge (5.51.0), then the frontend. Same rule: migrate before the flag is on.
3. Staging check (flag ON): freelancer → `/projects` → Show details → **Send a proposal** (price in ₹). Client → `/client/projects` → **Proposals** → **Make an offer** (edit milestones) → **Send offer**. Freelancer → `/contracts` → Open → **Accept version 1** → status Active; the listing shows Hiring. "Milestone funding is not available yet" is expected (payments are BLOCKED on D-1/D-2).

## Phase 3 batch 2 (release 5.52.0): delivery workspace
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0054_delivery_workspace`).
2. Deploy Edge (5.52.0), then the frontend.
3. Staging check: on an active contract → `/contracts` → Open → Workspace. Freelancer: **Deliver work** (note + https links). Client: **Review delivery** → Approve or Request revision (reason required; limited to the agreed rounds). When every milestone is approved the contract shows Completed. Messages and the activity list appear for both sides.

## Phase 3 batch 3 (release 5.53.0): change orders and reviews
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0055_change_orders_reviews`). Check: `SELECT count(*) FROM contracts WHERE status IN ('active','completed') AND agreed_version IS NULL;` returns 0.
2. Deploy Edge (5.53.0), then the frontend.
3. Staging check: active contract → **Propose a change order** (e.g. add a milestone) → the other party sees the banner and **Accept change** / **Reject change**. Completed contract → both parties **Submit review**; each sees the other's review only after both reviewed.

## Phase 4 batch 1 (release 5.54.0): ledger and fees (no money moves)
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0056_ledger_foundation`). Check the guards exist: `SELECT tgname FROM pg_trigger WHERE tgname LIKE 'ledger_%';` → 3 rows.
2. Deploy Edge (5.54.0), then the frontend.
3. Give yourself staff roles (Neon SQL Editor; replace the email): `INSERT INTO user_roles (id, user_id, role, status, granted_by) SELECT gen_random_uuid()::text, id, r, 'active', 'founder' FROM users, unnest(ARRAY['admin','finance']) AS r WHERE email = 'you@example.com' ON CONFLICT DO NOTHING;`
4. When D-5 is decided: open `/finance` → enter the fee schedule → **Save draft** → **Approve (admin)**. Contracts then show fee estimates. Until then they say "Platform fees have not been decided yet."

## Phase 5 batch 1 (release 5.55.0): plans and AI credits
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0057_plans_credits`). Check: `SELECT code, ai_daily_limit, ai_monthly_limit FROM plans;` → `free | 20 | 300`.
2. Deploy Edge (5.55.0), then the frontend. Account → "Plan and AI usage" shows today's and this month's AI drafts.
3. Admin (`/finance` → "Plans and AI credits"): create draft plans with limits (prices are D-14 and stay empty), Activate, give a plan to a user by email, grant AI credits (each grant is applied once).

## Phase 6 batch 1 (release 5.56.0): agent registry
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0058_agent_registry`). Check: `SELECT status, count(*) FROM agent_definitions GROUP BY status;` → live 4, partial 4, planned 17, blocked 3.
2. Deploy Edge (5.56.0), then the frontend. Sidebar → **AI agents** shows the catalogue and your agent activity.
3. Emergency stop for one agent (admin): `/ai-agents` → **Switch off** (its AI calls use templates until switched on). The global stop is still `FEATURE_FLAGS_OFF=ai.generation`.

## Phase 6 batch 2 (release 5.57.0): client assistants
1. "Stage 3C Neon migrations" (expects `0059_assistants_live`; data-only). Check: `SELECT code, status FROM agent_definitions WHERE code IN ('C3','C5','C6');` → live.
2. Deploy Edge (5.57.0), then the frontend. Client → Proposals → **Compare proposals**; **Make an offer** starts from the suggested split; Workspace → **Review delivery** shows the acceptance checklist.

## Phase 7 batch 1 (release 5.58.0): moderation, reports, admin
1. "Stage 3C Neon migrations" (expects `0060_trust_admin`). Check: `SELECT tgname FROM pg_trigger WHERE tgname = 'moderation_actions_append_only';` → 1 row.
2. Deploy Edge (5.58.0), then the frontend.
3. Give moderators the role (SQL as in Phase 4 step 3 with `'moderator'`). Sidebar → **Admin**: overview, moderation queue (Approve and publish / Return to client with a note), open reports, and — for admins — feature flags. **This is where you can now turn `marketplace.client_side` on or off without SQL.** `payments.live` is locked.
4. The SQL moderation steps in "Phase 2 batch 1" step 5 are no longer needed.

## Phase 4 batch 2 (release 5.60.0): money loop in test mode
1. "Stage 3C Neon migrations" (expects `0061_payments_sandbox`).
2. Deploy Edge (5.60.0), then the frontend.
3. To test: `/finance` → approve a fee schedule; `/admin` → Feature flags → turn on **payments.sandbox** (optionally **payments.require_funding**). On an active contract: Payments → **Fund milestone** → **Complete test payment**; the freelancer delivers; the client approves → the freelancer sees the money on **Earnings** and can **Withdraw** (test payout). Everything is labelled TEST MODE; no real money moves. `/finance` → trial balance must stay balanced.
4. Real payments: keep `payments.live` OFF (it is locked). After D-1/D-2, a live provider adapter is written and `PAYMENT_WEBHOOK_SECRET` is set as a Worker secret.

## Notifications (release 5.61.0) and Phase 7 batch 2 (release 5.62.0): disputes, suspension, appeals
1. Neon backup branch → "Stage 3C Neon migrations" (expects `0063_disputes_suspensions`; applies 0062 and 0063 if not yet run). Check: `SELECT count(*) FROM disputes;` → 0 and `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'suspended_at';` → 1 row.
2. Deploy Edge (5.62.0), then the frontend. Sign-in keeps working even if the Edge deploys before the migration (the suspension check tolerates the missing column).
3. Disputes: on an active contract, either side → **Raise a dispute**; staff → `/admin` → **Open disputes** → **Open evidence pack** → write the explanation → **No money moves** (moderator or admin) or **Release funded to freelancer** / **Refund funded to client** (admin only; test money until D-1/D-2).
4. Suspension: `/admin` → **Account suspensions** → user ID (from a user report) + reason → **Suspend**. The person sees the reason on `/account` and can appeal once; a different staff member accepts or rejects the appeal; anyone on staff can **Lift suspension**.

## Teams (release 5.63.0)
1. "Stage 3C Neon migrations" (expects `0064_org_invitations`). Check: `SELECT count(*) FROM organization_invitations;` → 0.
2. Deploy Edge (5.63.0), then the frontend.
3. To try: `/account` → Client accounts → **Team** → enter an email → **Create invitation** → **Copy link** and send it yourself (email sending waits for D-15). The person signs in with that email and opens the link (`/join?...`) → **Join**.

## Files (release 5.64.0): contract attachments in Cloudflare R2
1. "Stage 3C Neon migrations" (expects `0065_contract_files`). Check: `SELECT count(*) FROM contract_files;` → 0.
2. Deploy Edge (5.64.0), then the frontend. Without the bucket, the workspace says "File uploads are not switched on yet" and everything else works.
3. **Create the bucket (you):** Cloudflare dashboard → https://dash.cloudflare.com → your account → **R2 Object Storage** → (first time: enable R2; the free tier includes 10 GB-month of storage) → **Create bucket** → name `freelance-income-ai-files`, location Automatic, default storage class Standard → **Create bucket**. Leave **Public access** disabled (files are only served through the API).
4. **Switch the binding on:** in GitHub, `cloudflare-edge-api-phase1` → `backend/edge-api/wrangler.jsonc` → remove the `//` in front of the three `r2_buckets` lines → commit. Workers Builds redeploys the Edge API. (Or tell me and I will do it.) Expected: a contract's workspace shows **Add a file**. If the deploy fails with "bucket not found", the bucket name differs: fix the name in either place.
5. Note K-32: there is no malware scanning yet.

## Business workspace (release 5.65.0)
1. "Stage 3C Neon migrations" (expects `0070_discussions_interviews`). Checks: `SELECT status FROM agent_definitions WHERE code = 'F11';` → `partial`; `SELECT count(*) FROM listing_proposal_versions;` equals the number of proposals.
2. Open `/admin` → **System health**: it must say the database migrations are current. It also lists what still needs setup (R2 bucket, email provider, rate limits) without showing any secret value.
2. Deploy Edge (5.65.0), then the frontend. `/workspace`, `/agent` and `/coach` now load from the Edge API. The other older tools show a notice with links to the pages that do the same job.
3. The coach uses the AI quota of each user's plan and can be switched off on `/ai-agents` (F11).

## Rollback
- Edge or frontend: Cloudflare → Worker → **Deployments** → previous version → **Rollback**. If you roll the Edge API back, re-attach the old consumer to the queue.
- Database: see DATABASE_MIGRATION_STATUS.md (5.45 code runs on the 0049 schema).
- Kill switches without deploy: set `FEATURE_FLAGS_OFF=ai.generation` (or `*`) on the Edge Worker.
