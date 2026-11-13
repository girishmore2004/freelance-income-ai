# Release 5.0.0 verification

## Implemented

- Immutable client-contract revision snapshots, SHA-256 parent links and a revision-chain verification response.
- Initial contract creation stores revision 1. A subsequent revision is stored as a new snapshot, increments the contract version, invalidates the prior status and returns the current document to `draft`.
- Accepted, archived and expired contracts cannot be revised in place; create a separate contract for a new legal instrument.
- Deliverable acceptance/change-request events are stored against the current revision number and content hash, with owner-entered note/evidence reference.
- Historical client acceptance/change-request audit events are migrated into the new history table with an explicit `historical_migration` marker.
- Frontend controls added for contract revision history and deliverable acceptance history.

## Checks

The release packager should verify ZIP CRC and every SHA-256 manifest entry. Focused tests cover valid revision chains, tampering, missing versions and empty histories. Python compilation, JSON parsing and TypeScript syntax checks are run when available in the packaging environment.

## Not certified by local packaging

A successful package does not prove production database migration compatibility, full backend integration, browser workflows, deployment, backups or cloud availability. Run the complete CI suite against PostgreSQL and Redis, perform a staging migration and exercise the client and delivery screens before production rollout. No claim of legal e-signature, independently verified client identity or tamper-proof external ledger is made.

## Local execution record

- Contract revision-chain policy tests plus v4.9 contract policy tests: **7 passed**.
- Release packager tests: included in combined focused run; **9 tests passed** across the two policy suites and package-release tests.
- Python compilation: passed for backend app, migration and new test.
- Frontend TypeScript/TSX syntax transpilation: passed for `frontend/app/clients/page.tsx` and `frontend/app/delivery/page.tsx`.
- Frontend package JSON parse and version check: passed (`5.0.0`).
- ZIP CRC and manifest: passed; **327/327** file hashes verified; **0** forbidden entries; 329 archive entries.
- Alembic runtime graph inspection was blocked: local Python environment does not have `pgvector` (`ModuleNotFoundError: No module named 'pgvector'`). Therefore the migration was syntax-checked but not executed against PostgreSQL.
- Full backend suite, PostgreSQL migration upgrade/downgrade, Redis integration, full frontend typecheck/production build, Playwright, Docker builds and cloud staging tests were not run in this environment.
