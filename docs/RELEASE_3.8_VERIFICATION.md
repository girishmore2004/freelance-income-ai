# Release 3.8 verification

## Implemented
- Added authenticated two-account API regression tests for deliverables, time entries, invoice schedules, email intake, follow-up reminders, and portfolio documents/search.
- Existing core tenant tests and agent workflow tenant tests retained.
- No schema migration or new environment variables.

## Local results
- Focused non-HTTP usage and agent workflow regression tests: passed.
- Result: artifact_tool.rpc.client.RemoteError: Element ordering requires an owning element collection..
- Python compileall: passed.
- Route-level tenant API tests were **not executable in this environment** because `python-jose` (`jose`) is not installed. They must run in the normal CI environment with backend requirements installed.
- PostgreSQL/pgvector and Redis staging behavior are not inferred from SQLite tests.

## Remaining staging verification
Live Redis outage/recovery, full PostgreSQL integration, OAuth lifecycle, marketplace route coverage, frontend build, browser E2E, dependency audit, k6 baseline, and backup/restore drill remain outstanding.
