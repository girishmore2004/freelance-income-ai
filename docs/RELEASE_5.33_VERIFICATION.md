# v5.33.0 release verification

- Adds a per-project SHA-256 hash chain to delivery audit events, anchored by a persisted project head hash.
- Adds revision evidence coverage diagnostics for client-requested and approved-scope-change origins.
- Backfills existing events in migration `0037_delivery_audit_hash_chain`.
- Routes all nine existing `DeliveryAuditEvent` write sites through the chain append helper.
- Adds authenticated `GET /api/v1/analytics/delivery-audit-integrity` and a Business Intelligence view.
- Automated tests cover valid chains, event tampering, removal of an intermediate event, tail truncation, project-head mismatch, project isolation, migration ancestry, and evidence-link completeness/mismatch/unclassified handling.

Run `python -m pytest backend/tests/test_delivery_audit_integrity_v533.py backend/tests/test_revision_evidence_coverage_v533.py` and the focused regression suite. Run `python -m compileall -q backend/app backend/alembic/versions`.

A live PostgreSQL migration and frontend production build must be checked in the fully provisioned deployment environment; they are not claimed by this source-level release report.
