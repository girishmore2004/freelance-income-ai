# Upgrade v4.7.0 to v4.8.0

## Scope
This additive release introduces a first-party client CRM, project-to-client relationships, project activity history and a controlled scope-change approval workflow. It preserves the existing FastAPI, SQLAlchemy, Alembic and Next.js architecture.

## Database migration
Revision `0022_client_crm_scope` follows `0021_ai_usage_quotas`.
It creates:
- `clients` for account-owned client profiles.
- Nullable `projects.client_id` relationship with `ON DELETE SET NULL`.
- `scope_change_requests` for scope descriptions, budget/timeline deltas, approval fingerprints, client-acceptance attestation and decision history.

Run the migration once through your controlled release step:

```bash
cd backend
alembic upgrade head
```

Do not run migrations concurrently from multiple API replicas. Back up the database before applying the migration.

## Application features
- Create and search client records; update status and profile details through the API.
- Link projects to a client while retaining the legacy `client_name` field for compatibility.
- Read client activity from records linked through projects: project creation, received email, invoice and scope-change events.
- Draft scope changes with budget and timeline deltas.
- Submit scope changes for approval; the request content is fingerprinted.
- Approve only if the fingerprint is still current, the budget remains non-negative, timeline changes have a valid project due date, and the account owner attests that the client accepted the exact change and records the written-acceptance reference.
- Approved scope changes apply their budget and due-date deltas and are recorded in workspace events.
- Pending scope changes appear in the AI Action Planner.

## Deploy
1. Back up PostgreSQL.
2. Push the v4.8.0 commit and wait for CI.
3. Run `alembic upgrade head` once.
4. Deploy the API and frontend from the same commit.
5. Open `/clients`, create a test client, link a test project and inspect its activity history.
6. Create a test scope change and verify approval updates the project only after client-acceptance attestation.

## Rollback
The migration downgrade drops scope change and client tables and removes `projects.client_id`. This loses CRM and scope-change data created after upgrade. Prefer application rollback without database downgrade unless the new data is disposable and a verified backup exists.
