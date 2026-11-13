# Release 3.7 verification

## Implemented
- Agent workflow initiation uses the existing per-account AI quota gate.
- A single usage event is inserted in the same database transaction as a new workflow row.
- Idempotent replay is checked before quota enforcement and does not consume another usage event.
- Added tenant-boundary tests for owner-scoped workflow visibility and usage history isolation.
- No schema migration or new environment variable.

## Local verification
- Focused usage and agent-workflow regression tests: 5 passed.
- Python compilation: passed.
- ZIP CRC: passed.
- Source manifest SHA-256 validation: passed.
- `.env`, node_modules, Python bytecode and pytest caches excluded.

## Limitations
The focused tests used a temporary test-only `pgvector` SQLAlchemy type shim because `pgvector` is not installed in this build environment. This is not a substitute for PostgreSQL/pgvector integration testing. Live Redis, full authenticated API/browser E2E, frontend build, dependency audit, k6 staging baseline, and backup/restore drill remain unverified.
