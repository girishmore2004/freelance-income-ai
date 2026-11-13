# Production release gate checklist

This checklist separates code/package verification from environment-dependent release evidence. A green local compile or ZIP integrity check is not production certification.

## Required before a production release
- [ ] GitHub Actions full backend suite passes against migrated PostgreSQL + pgvector.
- [ ] Redis/RQ integration tests pass against the CI Redis service.
- [ ] Authenticated opportunity-to-invoice journey passes in CI.
- [ ] Frontend typecheck and production build pass.
- [ ] Playwright browser suite passes.
- [ ] Python and npm dependency audits complete; high/critical findings reviewed and fixed or explicitly risk-accepted.
- [ ] Staging k6 smoke test completed and summary reviewed; no thresholds or latency figures are assumed in advance.
- [ ] PostgreSQL backup checksum/archive validation succeeds.
- [ ] Restore drill succeeds against a disposable non-production database; application-level data checks are recorded.
- [ ] RAG/retrieval benchmark results are reviewed against a human-labelled, authorized dataset before making quality claims.
- [ ] Secrets, CORS, registration policy, database, Redis, worker and monitoring configuration reviewed for the target deployment.
- [ ] Human approval gates for proposal submission, client communication, deliverable handover and payment remain enabled.

## Evidence to retain
- GitHub Actions run URL and commit SHA.
- Dependency audit report.
- k6 summary artifact and staging environment identifier.
- Backup file checksum, restore command record and post-restore validation result.
- RAG benchmark dataset version, reviewer and results.

## Current v4.3.0 status
The repository contains the tests and scripts for several of these gates. Full CI, staging load testing, dependency audit and an actual restore drill still need to be run in their respective environments.


## Additional v4.4 evidence
- [ ] Queued cancellation integration test passes against CI Redis.
- [ ] Stale execution-attempt fencing unit test passes.
- [ ] Download and review the `dependency-audit-reports` CI artifact; resolve or document all actionable findings.


## v4.5 deployment-specific checks
- [ ] Vercel `NEXT_PUBLIC_API_URL` points to the production HTTPS API origin.
- [ ] Render API `FRONTEND_URL` and `CORS_ORIGINS` exactly match the Vercel origin.
- [ ] API and worker share the same PostgreSQL and Redis service URLs.
- [ ] Production Ollama endpoint is privately reachable and not localhost, or OpenAI is configured with a server-side key.
- [ ] Database migrations run once as a controlled pre-deploy step, not concurrently from multiple API replicas.
- [ ] API `/ready` returns HTTP 200 before worker deployment.
- [ ] Worker logs confirm Redis connectivity and queue subscription.


## v4.5 external execution evidence
- [ ] GitHub Actions full CI completed successfully on the exact release commit.
- [ ] Dependency audit artifacts reviewed; no unresolved high/critical findings without documented risk acceptance.
- [ ] Docker API and frontend images built successfully (if using Docker deployment).
- [ ] Render API `/ready` returns 200 after migrations.
- [ ] RQ worker connected to the same Redis queue and successfully processes a harmless test job.
- [ ] Vercel frontend can register/login and make authenticated API requests using the configured API origin.
- [ ] Production Ollama endpoint is reachable from the API/worker network, or OpenAI provider is deliberately configured.
- [ ] Backup and restore drills completed against disposable resources.
- [ ] Staging load and RAG human-review results attached to the release.


## v4.6 release packaging and recovery controls
- [ ] Run `python ops/package_release.py --output ../freelance-income-ai-v4.6.0.zip` and review the manifest.
- [ ] Confirm the ZIP contains no `.env`, local database, backup, cache, `.git` or dependency directory.
- [ ] Run `python -m unittest discover -s ops/tests -v`.
- [ ] Run a backup and checksum/archive verification against a non-production PostgreSQL database.
- [ ] Complete a restore drill against a disposable PostgreSQL database and validate application data after restore.


## v4.7 action planner validation
- [ ] Verify the action planner displays only the authenticated user's records.
- [ ] Verify milestone, deliverable, invoice schedule, proposal approval, email approval and marketplace application actions against seeded test records.
- [ ] Confirm completed, cancelled, issued, accepted and already-submitted records are not surfaced as pending work.
- [ ] Confirm all recommendations remain read-only and do not trigger external actions.


## v4.8 CRM and scope-change validation
- [ ] Apply migration `0022_client_crm_scope` to a disposable PostgreSQL database and verify upgrade/downgrade.
- [ ] Verify client CRUD and project linking cannot access another user's client or project.
- [ ] Verify client activity includes only records linked to the selected account-owned client's projects.
- [ ] Verify scope changes cannot be approved with a stale hash, without client acceptance evidence, with negative resulting budget, or with an invalid due date when a timeline delta is requested.
- [ ] Verify rejected and pending scope changes do not alter project budget or due date.
- [ ] Verify approved scope changes alter project budget/due date exactly once and create an audit event.


## v5.41.0 archive and deployment gate

- [ ] Run migration `0043_archive_bundle_and_supersession` against a disposable PostgreSQL + pgvector database.
- [ ] Verify archive ZIP export includes manifest, approved snapshot JSON/PDF, verification report and checksums.
- [ ] Verify tampered manifest, snapshot, sign-off and closure references block export.
- [ ] Verify archive supersession is append-only and never edits/deletes prior manifests.
- [ ] Verify recovery rehearsal is labelled human-reported and does not claim to execute a restore.
- [ ] Follow `docs/FINAL_DEPLOYMENT_GUIDE_5.41.md` and retain the exact GitHub CI commit/run URL.
- [ ] Do not claim production-ready until full CI, dependency audit, staging smoke tests and a real backup/restore drill pass.
