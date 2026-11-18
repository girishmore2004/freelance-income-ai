# Database Migration Status

Chain head: **`0067_proposal_studio`** (67 revisions, single head — verified by `tests/test_system_diagnostics_v542.py`). Neon staging was last migrated to 0046 (per workflow pin).

| Revision | Change | Type | Downgrade |
|---|---|---|---|
| 0047_edge_apply_tables | Captures `integrations`, `applications`, `application_messages` used by the Edge API; adds missing columns to hand-made tables; unique `(user_id, provider)`, unique `(user_id, external_id)`, partial unique "one live send per proposal"; `integrations.id` DB default | Additive; stops with a clear message if duplicates exist | Removes indexes only; keeps tables and data |
| 0048_queue_job_reliability | `background_jobs`: `idempotency_key` (unique), `attempts`, `payload_json`, `source`, `dead_lettered_at`; index `(status, created_at)` | Additive | Drops added columns/indexes |
| 0051_native_project_listings | `project_categories` (8 seeded from the Master Plan; only `website_development` enabled), `project_listings` (status/visibility/moderation check constraints, indexes for org lists and the marketplace), `project_listing_versions` (immutable, unique per listing+version, money in minor units, budget range check) | Additive + seed | Drops the three tables |
| 0066_business_coach_partial | Data only: agent F11 `planned` → `partial` with runtime name `business_coach` | Data | Restores `planned` |
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
3. Run GitHub Action **"Stage 3C Neon migrations"** in `freelance-income-ai` (type the confirmation text). It expects `0067_proposal_studio`.
4. Deploy the Edge API (5.72.0 needs 0047–0067; before 0067 the short proposal form still works and Studio sections return `MIGRATION_PENDING` before `marketplace.client_side` is switched on; AI keeps working on Worker limits if 0057 is not applied yet).
5. Deploy the frontend.

If 0047 stops with "existing rows contain duplicates", nothing was committed: inspect the listed rows in Neon's SQL Editor, keep the correct one, then rerun.

## Rollback
- Code-only problem: roll back the Worker in Cloudflare (Deployments → previous version). The schema is backward compatible with 5.45 code.
- Schema problem: restore by resetting `main` from the backup branch in Neon (loses writes made after the backup) — or run `alembic downgrade 0046_agent_workflow_rq_job_id` from the workflow environment; 0047's downgrade keeps the tables.

## Verification queries (Neon SQL Editor)
```sql
SELECT version_num FROM alembic_version;                       -- 0067_proposal_studio
SELECT count(*) FROM listing_proposal_versions;                 -- equals count(*) FROM listing_proposals right after the run
SELECT slug, enabled FROM project_categories ORDER BY sort_order; -- only website_development = true
SELECT role, count(*) FROM user_roles GROUP BY role;            -- freelancer = number of users
SELECT key, enabled FROM feature_flags ORDER BY key;            -- payments.live = false
SELECT indexname FROM pg_indexes WHERE tablename IN ('applications','application_messages','integrations','background_jobs') ORDER BY 1;
```
