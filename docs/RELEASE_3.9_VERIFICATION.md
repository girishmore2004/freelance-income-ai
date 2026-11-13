# Release 3.9 verification

## Implemented
- Additional two-account tenant API regression tests for marketplace applications, email provider account metadata, deliverable revisions, invoice schedules, and durable workflow checkpoints.
- Portfolio embedding and semantic-search embedding use the existing account quota gate.
- Successful non-empty embeddings are recorded in AI usage history without inventing tokens or costs.
- Deliverable revision counting and delivery-summary revision aggregation explicitly include user ownership.
- Version metadata updated to 3.9.0.
- No schema migration or new environment variables.

## Local checks executed
- Focused existing usage and agent-workflow tests: 5 passed.
- Python compileall across app, scripts and tests: passed.
- ZIP CRC validation: passed.
- All source manifest SHA-256 values: passed.
- `.env`, node_modules, Python bytecode and pytest caches excluded.

## Tests not executed
- New route-level `test_tenant_isolation_v39.py` and prior API tenant suites could not be collected because `python-jose` (`jose`) is missing from this build environment.
- PostgreSQL/pgvector integration, live Redis outage/recovery, provider-mocked OAuth lifecycle, frontend build, browser E2E, dependency audit, k6 staging baseline, and backup/restore drill were not run.
- A temporary test-only pgvector SQLAlchemy type shim was used for the focused tests; it is not included in the release.

This release is not a production security certification.
