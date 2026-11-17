# Database Migration Status

Chain head: **`0049_feature_flags_ai_cost`** (49 revisions, single head — verified by `tests/test_system_diagnostics_v542.py`). Neon staging was last migrated to 0046 (per workflow pin).

| Revision | Change | Type | Downgrade |
|---|---|---|---|
| 0047_edge_apply_tables | Captures `integrations`, `applications`, `application_messages` used by the Edge API; adds missing columns to hand-made tables; unique `(user_id, provider)`, unique `(user_id, external_id)`, partial unique "one live send per proposal"; `integrations.id` DB default | Additive; stops with a clear message if duplicates exist | Removes indexes only; keeps tables and data |
| 0048_queue_job_reliability | `background_jobs`: `idempotency_key` (unique), `attempts`, `payload_json`, `source`, `dead_lettered_at`; index `(status, created_at)` | Additive | Drops added columns/indexes |
| 0049_feature_flags_ai_cost | `feature_flags` table with seeded safe defaults; `ai_usage_events.estimated_cost_micros`, `service` | Additive | Drops table/columns (operational data only) |

## Safe deployment order
1. **Back up** Neon (create a branch named `pre-0047-2026-11` from `main` in Neon → Branches). Branch creation is instant and is the rollback point.
2. Optional dry run: run the migration workflow against the backup branch first.
3. Run GitHub Action **"Stage 3C Neon migrations"** in `freelance-income-ai` (type the confirmation text). It expects `0049_feature_flags_ai_cost`.
4. Deploy the Edge API (it needs 0047–0049).
5. Deploy the frontend.

If 0047 stops with "existing rows contain duplicates", nothing was committed: inspect the listed rows in Neon's SQL Editor, keep the correct one, then rerun.

## Rollback
- Code-only problem: roll back the Worker in Cloudflare (Deployments → previous version). The schema is backward compatible with 5.45 code.
- Schema problem: restore by resetting `main` from the backup branch in Neon (loses writes made after the backup) — or run `alembic downgrade 0046_agent_workflow_rq_job_id` from the workflow environment; 0047's downgrade keeps the tables.

## Verification queries (Neon SQL Editor)
```sql
SELECT version_num FROM alembic_version;                       -- 0049_feature_flags_ai_cost
SELECT key, enabled FROM feature_flags ORDER BY key;            -- payments.live = false
SELECT indexname FROM pg_indexes WHERE tablename IN ('applications','application_messages','integrations','background_jobs') ORDER BY 1;
```
