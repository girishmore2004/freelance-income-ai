# Release 4.4.0 verification report

## Local checks
- Source package: v4.3.0.
- Added stale-worker fencing unit regression.
- Added Redis queued-cancellation integration regression (requires `TEST_REDIS_URL`).
- Dependency audit CI now uploads JSON evidence on success or failure.
- Playwright dependency pinned to 1.56.1.
- Python compilation, focused tests, YAML/JSON validation, shell syntax, ZIP CRC and manifest hashes are reported in the release handoff.

## Environment-dependent gates still required
- New stale-worker fencing unit test must pass in full backend CI.
- New Redis cancellation integration test requires CI Redis and must pass there.
- Full PostgreSQL/pgvector API suite and migration chain.
- Frontend npm install, typecheck, production build and Playwright.
- Python and npm dependency audits; inspect the uploaded JSON report and resolve or formally risk-accept findings.
- Staging k6 run and review of its actual summary.
- PostgreSQL backup restore drill against a disposable database.
- Human-reviewed RAG/retrieval benchmark.

## Release status
This ZIP is integrity-verified, not production-certified. Do not claim production readiness until all gates in `docs/PRODUCTION_RELEASE_GATE.md` have evidence attached to the release.
