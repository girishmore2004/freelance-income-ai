# Database Migration Status

Chain head: **`0052_invitations_saved_freelancers`** (52 revisions, single head — verified by `tests/test_system_diagnostics_v542.py`). Neon staging was last migrated to 0046 (per workflow pin).

| Revision | Change | Type | Downgrade |
|---|---|---|---|
| 0047_edge_apply_tables | Captures `integrations`, `applications`, `application_messages` used by the Edge API; adds missing columns to hand-made tables; unique `(user_id, provider)`, unique `(user_id, external_id)`, partial unique "one live send per proposal"; `integrations.id` DB default | Additive; stops with a clear message if duplicates exist | Removes indexes only; keeps tables and data |
| 0048_queue_job_reliability | `background_jobs`: `idempotency_key` (unique), `attempts`, `payload_json`, `source`, `dead_lettered_at`; index `(status, created_at)` | Additive | Drops added columns/indexes |
| 0051_native_project_listings | `project_categories` (8 seeded from the Master Plan; only `website_development` enabled), `project_listings` (status/visibility/moderation check constraints, indexes for org lists and the marketplace), `project_listing_versions` (immutable, unique per listing+version, money in minor units, budget range check) | Additive + seed | Drops the three tables |
| 0052_invitations_saved_freelancers | `profiles.marketplace_visible` (default false) + `marketplace_visible_at`; `listing_invitations` (unique listing+freelancer, status check, index by freelancer); `saved_freelancers` (unique organisation+freelancer) | Additive; no profile becomes visible | Drops the two tables and two columns |
| 0050_identity_roles_orgs | `user_roles` (check-constrained roles/status, unique per user+role), `organizations` (individual/company, billing identity; `created_by` SET NULL), `organization_memberships` (owner/admin/member); backfills an active `freelancer` role for every existing user (idempotent) | Additive + backfill | Drops the three tables |
| 0049_feature_flags_ai_cost | `feature_flags` table with seeded safe defaults; `ai_usage_events.estimated_cost_micros`, `service` | Additive | Drops table/columns (operational data only) |

## Safe deployment order
1. **Back up** Neon (create a branch named `pre-0047-2026-11` from `main` in Neon → Branches). Branch creation is instant and is the rollback point.
2. Optional dry run: run the migration workflow against the backup branch first.
3. Run GitHub Action **"Stage 3C Neon migrations"** in `freelance-income-ai` (type the confirmation text). It expects `0052_invitations_saved_freelancers`.
4. Deploy the Edge API (5.50.0 needs 0047–0052 before `marketplace.client_side` is switched on).
5. Deploy the frontend.

If 0047 stops with "existing rows contain duplicates", nothing was committed: inspect the listed rows in Neon's SQL Editor, keep the correct one, then rerun.

## Rollback
- Code-only problem: roll back the Worker in Cloudflare (Deployments → previous version). The schema is backward compatible with 5.45 code.
- Schema problem: restore by resetting `main` from the backup branch in Neon (loses writes made after the backup) — or run `alembic downgrade 0046_agent_workflow_rq_job_id` from the workflow environment; 0047's downgrade keeps the tables.

## Verification queries (Neon SQL Editor)
```sql
SELECT version_num FROM alembic_version;                       -- 0052_invitations_saved_freelancers
SELECT slug, enabled FROM project_categories ORDER BY sort_order; -- only website_development = true
SELECT role, count(*) FROM user_roles GROUP BY role;            -- freelancer = number of users
SELECT key, enabled FROM feature_flags ORDER BY key;            -- payments.live = false
SELECT indexname FROM pg_indexes WHERE tablename IN ('applications','application_messages','integrations','background_jobs') ORDER BY 1;
```
