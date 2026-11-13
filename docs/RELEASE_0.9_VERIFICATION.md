# Release 0.9 verification plan

## Static checks
```bash
cd backend
python -m compileall -q app
pytest -q
alembic upgrade head
```

## Frontend checks
```bash
cd frontend
npm ci
npm run typecheck
npm run build
```

## Source health acceptance
1. Create and enable a public RSS/JSON source.
2. Queue discovery and verify health becomes healthy with last_checked_at, last_success_at, latency and item count.
3. Configure a deliberately invalid but syntactically valid public URL in a test environment.
4. Queue discovery and verify failure count increments, health changes to degraded/failing, last_error is stored and next_retry_at is set.
5. Queue again before next_retry_at and verify the source is skipped.
6. After retry time, restore the feed and verify a successful scan resets failures and clears backoff.

## Evidence provenance acceptance
1. Save a research claim with an HTTPS URL.
2. Verify source_host equals the URL hostname and evidence_hash is a 64-character SHA-256 hex digest.
3. Save a note without URL and verify source_host is blank but a digest still exists.
4. Confirm another user's evidence is not visible.
5. Confirm the UI labels confidence as the user's assessment and does not claim independent verification.

## Environment verification caveat
Do not mark production deployment complete until the migrations run against the actual database, full backend test suite passes with all pinned requirements, frontend typecheck/build succeeds, Docker images build, and a live source health/retry test passes.
