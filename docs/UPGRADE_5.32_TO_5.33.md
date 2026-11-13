# Upgrade v5.32.0 to v5.33.0

## What changes

- Adds `previous_hash`, `event_hash`, and `chain_version` to `delivery_audit_events`, plus a persisted `delivery_audit_head_hash` on each project.
- Migration `0037_delivery_audit_hash_chain` backfills existing events in deterministic per-user/per-project order before new writes use the chain.
- All delivery and invoice-schedule audit writes now append to the project chain while locking the owning project row where the database supports row locks.
- Adds `GET /api/v1/analytics/delivery-audit-integrity`, scoped to the authenticated user's events.
- Adds chain status and limitations to Business Intelligence.

## Deployment

1. Back up PostgreSQL and verify the backup can be restored.
2. Deploy the backend source and run `cd backend && alembic upgrade head`.
3. Deploy the frontend source.
4. Sign in and open Business Intelligence. Check the Delivery audit integrity section. Existing events are backfilled by migration; an integrity issue should be investigated before relying on that project's history.

Do not reset the production database. The migration backfills existing audit rows; it does not delete historical events.

## Security limitations

Hash chaining plus the persisted project head is tamper-evident, not tamper-proof. It detects event edits, middle-event deletion, and tail truncation unless a privileged database actor also rewrites the project head and recomputes the entire chain. It is not a digital signature, external timestamp, or independent proof of client communications. Keep database backups and restrict database write access.


## Revision evidence coverage

The release also adds `GET /api/v1/analytics/revision-evidence-coverage`. It validates client-requested revision links against the exact change-request event, revision number and content hash; approved-scope-change links must match the same project and be marked approved and client-accepted. Only those two explicit origin categories are included in the evidence coverage denominator. Unclassified revisions remain unknown.
