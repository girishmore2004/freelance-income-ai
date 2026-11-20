# Database Migration Status

Chain head: **`0080_review_deadlines`** (80 revisions, single head — verified by `tests/test_system_diagnostics_v542.py`). Neon production: **0075** (2026-11-18 22:21 IST, workflow "Neon PRODUCTION Database Migrations"); test branch `stage3c-integration-test`: 0073. Production appears to have reached 0079 (agent health shows the 0079 evaluations); 0080 runs next.

| Revision | Change | Type | Downgrade |
|---|---|---|---|
| 0080_review_deadlines | `milestone_submissions.review_extensions` SMALLINT NOT NULL DEFAULT 0 (service-order review extensions, 5 days each, at most 2) | Additive. Before it runs, the Edge shows no extension button result (503 `MIGRATION_PENDING` on extend) and the automatic completion job finds nothing; everything else works | Drops the column |
| 0079_agents_complete | `trust_signals` (refused contact/payment messages; kind and context checks; user CASCADE, counterpart and organisation SET NULL; indexes by user and organisation + time), `discovery_sources.terms_url`, `permitted_fields`, `reviewed_at`, `reviewed_by_user_id`, `source_takedowns` (unique source + link), `notification_preferences` (PK user + group; group check; no row = on). Registry: F1, F3, F7, F9, F11, C7, P1, P5, P7, P8, P9 `partial` → `live`; F3 and C7 gain run names | Additive + data. Before it runs the Edge records no signals, mutes nobody, and terms/takedowns/settings answer `MIGRATION_PENDING` | Drops the three tables and four columns, restores `partial` |
| 0078_fair_proposals_blocks | `project_listings.max_proposals` (1–500 or NULL, check) and `proposals_closed_at`; `marketplace_blocks` (freelancer ↔ client account, one row per side, side check, unique freelancer+organisation+side; user and organisation CASCADE, creator SET NULL; index by organisation). The weekly proposal limit is computed (no table) | Additive. The Edge treats every project as open and nobody as blocked before it runs; block and cap routes answer `MIGRATION_PENDING` | Drops the table and the two columns |
| 0047_edge_apply_tables | Captures `integrations`, `applications`, `application_messages` used by the Edge API; adds missing columns to hand-made tables; unique `(user_id, provider)`, unique `(user_id, external_id)`, partial unique "one live send per proposal"; `integrations.id` DB default | Additive; stops with a clear message if duplicates exist | Removes indexes only; keeps tables and data |
| 0048_queue_job_reliability | `background_jobs`: `idempotency_key` (unique), `attempts`, `payload_json`, `source`, `dead_lettered_at`; index `(status, created_at)` | Additive | Drops added columns/indexes |
| 0051_native_project_listings | `project_categories` (8 seeded from the Master Plan; only `website_development` enabled), `project_listings` (status/visibility/moderation check constraints, indexes for org lists and the marketplace), `project_listing_versions` (immutable, unique per listing+version, money in minor units, budget range check) | Additive + seed | Drops the three tables |
| 0066_business_coach_partial | Data only: agent F11 `planned` → `partial` with runtime name `business_coach` | Data | Restores `planned` |
| 0069_external_pipeline | `proposal_versions` (unique proposal+version, source check, backfilled from current proposals as `legacy`) and `opportunity_events` (kind check, application SET NULL, indexes by opportunity and by user+due date) | Additive + backfill | Drops both tables |
| 0068_saved_listings_support | `saved_listings` (unique user+listing, both CASCADE, note ≤ 300) and `support_tickets` (topic/status checks, user SET NULL, indexes by status and by user) | Additive | Drops both tables |
| 0067_proposal_studio | `listing_proposals` + `sections_json`, `current_version` (default 1), `content_hash`, `revision_requested_at`, `revision_note`; new `listing_proposal_versions` (unique proposal/version, version ≥ 1, price > 0); existing proposals backfilled as version 1 | Additive | Drops the table and the five columns |
| 0065_contract_files | `contract_files` (party/status/size checks, unique R2 key, indexes by contract and delivery; `submission_id` SET NULL, contract CASCADE) | Additive | Drops the table (remove the R2 objects by hand) |
| 0064_org_invitations | `organization_invitations` (role admin/member, status checks, unique token hash, one pending invitation per organisation + email, indexes by organisation and by email) | Additive | Drops the table |
| 0063_disputes_suspensions | `users.suspended_at`; `disputes` (party/reason/status/resolution checks, one open dispute per contract via partial unique index, contract RESTRICT), `dispute_statements` (party check), `account_suspensions` (status and appeal checks, one active suspension per user) | Additive. The Edge reads `suspended_at` through `to_jsonb(users)`, so sign-in keeps working before this runs | Drops the three tables and the column |
| 0062_notifications_inbox | `notifications`: `kind`, `link`, `read_at`, `dedupe_key` (unique), index (user_id, created_at) | Additive | Drops the added columns and indexes |
| 0061_payments_sandbox | `payment_intents` (amount checks, total = amount + client fee, one open funding per milestone), `payment_events` (unique provider+event), `payouts` (unique idempotency key), `billing_invoices` (one per payment), `contract_cancellations` (one open per contract); flags `payments.sandbox` and `payments.require_funding` seeded OFF | Additive + flags | Drops the five tables and two flags |
| 0060_trust_admin | `reports` (target/reason/status checks, one open report per reporter+target), `moderation_actions` (append-only; PostgreSQL trigger refuses UPDATE/DELETE) | Additive | Drops trigger, function and both tables |
| 0059_assistants_live | Data only: C3, C5, C6 `planned` → `live` with their run names | Data | Restores `planned` |
| 0058_agent_registry | `agent_definitions` (28 seeded agents, side/ceiling/status checks, `enabled` switch); index `agent_runs(user_id, created_at)` | Additive + seed | Drops the table and the index |
| 0057_plans_credits | `plans` (price optional, limit/interval/status checks; seeds only `free` = 20/day, 300/month, price 0), `user_plans` (one per user), `ai_credit_ledger` (signed deltas ≠ 0, unique reason+ref) | Additive + seed | Drops the three tables |
| 0056_ledger_foundation | `ledger_accounts` (unique code+currency, kind/owner checks), `ledger_entries` (unique idempotency key, sandbox/live mode, optional contract, reversal link), `ledger_lines` (debit/credit, amount > 0), `fee_schedules` (0–3000 bps, minimum ≥ 0, draft/approved/retired; **not seeded**); PostgreSQL only: deferred balance trigger and append-only triggers | Additive | Drops triggers, functions and the four tables (ledger data is lost — export first if any exists) |
| 0055_change_orders_reviews | `contracts.agreed_version` (backfilled = current_version for active/completed); `contract_reviews` (unique contract+party, rating 1–5, party check) | Additive + backfill | Drops the table and the column |
| 0054_delivery_workspace | `contracts.completed_at`; `contract_messages` (party check); `milestone_submissions` (status/index checks, partial unique index: one delivery awaiting review per milestone); `contract_events` (append-only activity, party check) | Additive | Drops the three tables and the column |
| 0053_proposals_contracts | `listing_proposals` (unique listing+freelancer, price > 0, status/model/days checks), `contracts` (status check, partial unique index: one offered/active contract per proposal; RESTRICT on listing, proposal, organisation, freelancer), `contract_versions` (unique contract+version, total > 0, revisions 0–10, proposer, per-party acceptance timestamps) | Additive | Drops the three tables |
| 0052_invites_saved_freelancers | `profiles.marketplace_visible` (default false) + `marketplace_visible_at`; `listing_invitations` (unique listing+freelancer, status check, index by freelancer); `saved_freelancers` (unique organisation+freelancer) | Additive; no profile becomes visible | Drops the two tables and two columns |
| 0050_identity_roles_orgs | `user_roles` (check-constrained roles/status, unique per user+role), `organizations` (individual/company, billing identity; `created_by` SET NULL), `organization_memberships` (owner/admin/member); backfills an active `freelancer` role for every existing user (idempotent) | Additive + backfill | Drops the three tables |
| 0049_feature_flags_ai_cost | `feature_flags` table with seeded safe defaults; `ai_usage_events.estimated_cost_micros`, `service` | Additive | Drops table/columns (operational data only) |

## Safe deployment order
1. **Back up** Neon (create a branch named `pre-0047-2026-11` from `main` in Neon → Branches). Branch creation is instant and is the rollback point.
2. Optional dry run: run the migration workflow against the backup branch first.
3. Run GitHub Action **"Stage 3C Neon migrations"** in `freelance-income-ai` (type the confirmation text). It expects `0080_review_deadlines`.
4. Deploy the Edge API (5.73.0 needs 0047–0068; saving projects and support tickets fail until 0068 runs, the calendar works without it; before 0067 the short proposal form still works and Studio sections return `MIGRATION_PENDING` before `marketplace.client_side` is switched on; AI keeps working on Worker limits if 0057 is not applied yet).
5. Deploy the frontend.

If 0047 stops with "existing rows contain duplicates", nothing was committed: inspect the listed rows in Neon's SQL Editor, keep the correct one, then rerun.

## Rollback
- Code-only problem: roll back the Worker in Cloudflare (Deployments → previous version). The schema is backward compatible with 5.45 code.
- Schema problem: restore by resetting `main` from the backup branch in Neon (loses writes made after the backup) — or run `alembic downgrade 0046_agent_workflow_rq_job_id` from the workflow environment; 0047's downgrade keeps the tables.

## Verification queries (Neon SQL Editor)
```sql
SELECT version_num FROM alembic_version;                       -- 0080_review_deadlines
SELECT count(*) FROM listing_proposal_versions;                 -- equals count(*) FROM listing_proposals right after the run
SELECT slug, enabled FROM project_categories ORDER BY sort_order; -- only website_development = true
SELECT role, count(*) FROM user_roles GROUP BY role;            -- freelancer = number of users
SELECT key, enabled FROM feature_flags ORDER BY key;            -- payments.live = false
SELECT indexname FROM pg_indexes WHERE tablename IN ('applications','application_messages','integrations','background_jobs') ORDER BY 1;
```


## 0070_discussions_interviews (5.75.0)
Additive: `proposal_messages` (proposal_id → listing_proposals CASCADE, sender_party client|freelancer, body; index proposal_id+created_at) and `proposal_interviews` (proposed_party, starts_at, duration 15–180, mode video|phone|chat, meeting_link, agenda, status proposed|accepted|declined|cancelled|completed, responded_by/at, outcome_note; index proposal_id+starts_at). Downgrade drops both. Verify: `SELECT to_regclass('proposal_messages'), to_regclass('proposal_interviews');` → both non-null. Until it runs, discussion routes answer `MIGRATION_PENDING` (503) and the inbox shows contract and external threads only.

## 0071_files_verification_sources (5.76.0)
Additive: `listing_files` (listing CASCADE, unique R2 key, size > 0, status ready|deleted), `verification_requests` (subject freelancer|client, status pending|approved|rejected|revoked, one pending per subject via partial unique index), `profiles.verified_at`, `organizations.verified_at`, `discovery_sources` (7 sources seeded enabled), `discovery_source_runs` (index source+created_at). Downgrade drops the tables and the two columns. Before it runs: verification and source switches answer `MIGRATION_PENDING`, listing files list empty, discovery runs every source as before. Verify: `SELECT code, enabled FROM discovery_sources;` → 7 rows, all true.

## 0072_contract_tasks_handover (5.77.0)
Additive: `contract_tasks` (party/status/source checks, milestone_index ≥ 0, index contract+position) and `contract_handover_items` (kind/status checks). Downgrade drops both. Verify: `SELECT to_regclass('contract_tasks'), to_regclass('contract_handover_items');` → both non-null.

## 0077_agent_registry_refresh (5.88.0)
Data only. Rows still `planned` change: F5, F8, C4, P3 → `live` (runtime names `pricing_advice`, `delivery_qa`, `interview_prep`, `dispute_evidence`); F7, C7, P5, P7, P9 → `partial`. Payment agents (F10, P2, P6) stay blocked. Downgrade returns exactly these rows to `planned`. Verify: `SELECT code, status FROM agent_definitions WHERE code IN ('F5','F8','C4','P3');` → live.

## 0076_hourly_contracts (5.85.0)
Additive. `contract_versions.billing_json` (empty = fixed price, all existing rows); `contract_timesheets` (one per contract and Monday week; status open/submitted/approved/paid; minutes ≥ 0, rate > 0; amount frozen at submission) and `contract_time_entries` (1–1440 minutes, CASCADE with the week). `payment_intents.timesheet_id` (nullable FK); the "one open funding per milestone" partial index now excludes hourly payments, and a new partial unique index allows one open or released payment per week. Downgrade refuses while hourly payments exist; otherwise reverses everything and restores the original index. Before it runs, hourly offers answer `MIGRATION_PENDING` and the Hours routes 503; fixed-price contracts are unaffected. Verify: `SELECT to_regclass('contract_timesheets'), to_regclass('contract_time_entries');` and `\d payment_intents` shows `timesheet_id`.

## 0075_services_categories (5.84.0)
Additive except one relaxation. Opens every work category (D-6). New `services` (status/price checks; indexes for the marketplace and per freelancer) and `service_orders` (one per contract, package/terms checks, RESTRICT on service, contract, organisation and freelancer). `contracts.listing_id` and `proposal_id` become nullable (contracts from service orders have neither; existing rows unchanged). `reports.target_type` may be `service`. Downgrade refuses while service-order contracts exist; otherwise drops both tables, restores NOT NULL and the report check, and closes every category except website development. Before it runs the Edge answers `MIGRATION_PENDING` for services; contracts, tasks, analytics and profiles keep working. Verify: `SELECT count(*) FROM project_categories WHERE enabled;` → 8; `SELECT to_regclass('services'), to_regclass('service_orders');` → both non-null.

## 0074_profile_projects (5.83.0)
Additive. `profiles.portfolio_items_json` (Text, NOT NULL, default `'[]'`): the freelancer's own projects (title, description, skills, link, year; ≤ 20, validated by the Edge API). Registry: F3 Profile and Portfolio Coach `planned` → `partial`, runtime name `profile_coach` (rows an admin changed are left alone). Downgrade drops the column and restores F3 to `planned`. Edge before 0074: projects read as unavailable, saving returns 503 `MIGRATION_PENDING`; resume import and Projects for you still work. Verify: `SELECT portfolio_items_json FROM profiles LIMIT 1;` and `SELECT status FROM agent_definitions WHERE code='F3';` → `partial`.

## 0073_saved_searches (5.78.0)
Additive: `saved_searches` (user CASCADE, budget ≥ 0 check, indexes by user and alerts). Downgrade drops it. Before it runs, saved searches answer `MIGRATION_PENDING` and publishing sends no alerts.
