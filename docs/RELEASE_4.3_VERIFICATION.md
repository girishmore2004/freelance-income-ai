# Release 4.3.0 verification report

## Local checks completed
- Source base: v4.2.0.
- New authenticated API journey test added and included in the standard pytest discovery path.
- Python compileall: run after changes (see final release summary).
- Existing focused unit tests: run after changes (see final release summary).
- Backup restore script shell syntax: checked with `bash -n`.
- CI workflow and staging-load workflow: parsed successfully as YAML.
- `docs/PRODUCTION_RELEASE_GATE.md` added to distinguish required evidence from local packaging checks.
- CI and staging workflow YAML: parsed.
- Frontend package metadata: parsed as JSON.
- ZIP CRC and manifest verification: see final release summary.

## New test/tool coverage
- Deterministic opportunity → proposal → explicit approval → project → deliverable review → delivery-reference record → unpaid invoice API journey.
- Proposal AI provider is replaced by a deterministic test stub.
- Backup checksum and pg_restore archive-list validation.
- Optional actual restore is protected by explicit environment opt-in and a separate database URL check.
- Staging k6 workflow requires manual dispatch, HTTPS and a staging-labelled hostname, plus a confirmation input.

## Not run / pending
- The new FastAPI journey test could not be executed in this local runtime because `python-jose` is unavailable (`ModuleNotFoundError: jose`). It must pass in full GitHub Actions CI before merge.
- Redis worker integration tests still require the CI Redis service.
- Frontend npm install, typecheck, build and Playwright E2E were not completed locally.
- Python/npm dependency vulnerability audits were not completed.
- No k6 test was run against staging; no latency/throughput numbers are claimed.
- No actual PostgreSQL backup restore was run. The restore script was syntax-checked only; run it against a disposable non-production database.
- No production deployment or security certification was performed.

## Release gate
Do not call this release production-ready until full CI passes, staging k6 results are reviewed, dependency audit findings are resolved, and a disposable-database restore drill succeeds.
