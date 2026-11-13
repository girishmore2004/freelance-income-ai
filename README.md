# Freelance Income AI

A personal, human-approved freelance opportunity workspace. This repository contains authentication, profile management, multi-source opportunity intake (manual, RSS/Atom and public JSON feeds), deterministic scoring, AI-assisted proposal drafting (Ollama or optional OpenAI), hash-bound approval records, project tracking, invoice tracking, client research and risk screening, background workers, portfolio retrieval and n8n workflow examples.

> This is not a promise of automatic access to every marketplace. Platform APIs require provider credentials and sometimes provider approval. The included manual, RSS/Atom and public JSON feed intake is usable when you configure permitted source URLs. No marketplace scraping, CAPTCHA bypass, auto-apply, contract acceptance, or payment execution is included. v5.8.0 adds user-owned saved Upwork searches and scheduled read-only discovery; v5.9.0 adds risk-aware opportunity ranking with evidence-confidence weighting; v5.10.0 adds portfolio-grounded proposal drafting with user-scoped evidence retrieval and source provenance; v5.19.0 adds service-category and opportunity-created cohort intelligence; v5.21.0 adds capacity-aware pursuit planning using profile weekly capacity and observed active-project time logs; v5.23.0 adds task-level effort estimates and forward workload commitments with weekly overload detection; v5.24.0 adds explicit task dependencies, cycle prevention, critical-path diagnostics and schedule-conflict review; v5.25.0 adds read-only capacity-aware schedule recommendations using task effort, dependency order, weekday capacity and calendar blocks; v5.26.0 adds versioned schedule-plan drafts, stale-input protection, explicit approval/rejection, audit snapshots and guarded rollback; v5.27.0 adds task completion timestamps and actual-versus-planned delivery intelligence using task-linked time logs; v5.28.0 adds read-only adaptive effort suggestions from similar completed tasks with recorded time, confidence and historical ranges; v5.29.0 adds dependency-based delivery bottleneck review signals and deliverable revision-activity analytics; v5.30.0 adds explicit client feedback, sample-gated acceptance rates, timestamp-grounded acceptance cycles and separate scope-change summaries; v5.31.0 adds explicit deliverable revision-origin classification and evidence-gated origin capture; v5.20.0 adds profile-to-portfolio opportunity fit diagnostics and listing-quality coverage; v5.16.0 adds 30/90/180-day source activity intelligence with payment-ledger receipt/refund attribution; v5.15.0 adds currency-safe source ROI and deterministic factual-claim review flags; v5.7.0 introduced the underlying GraphQL job search after approved API access and OAuth consent. Freelancer API access remains pending. Proposal submission remains disabled.

## Quick start (Docker)

1. Install Docker Desktop and Git.
2. Copy `.env.example` to `.env` and set a long random `SECRET_KEY`.
3. Run `docker compose up --build`.
4. API: <http://localhost:8000/docs>; frontend: <http://localhost:3000>.
5. Register an account in the UI or use `POST /api/v1/auth/register`.
6. Add your profile and portfolio, then create an opportunity manually or run RSS discovery.

The default compose setup uses PostgreSQL. For a quick backend-only local run, see `docs/INSTALLATION.md`.

## What works in this repository (Release 5.45.0)

- Email/password registration and JWT login.
- User-scoped profile, portfolio, opportunities, proposals, approvals, projects and invoices.
- RSS feed ingestion and manual opportunity creation.
- Saved RSS source management and scheduled n8n-triggered discovery using a shared secret.
- Duplicate prevention by source + external ID / canonical URL hash.
- Transparent 100-point scoring (skills, budget, client evidence, scope, deadline, portfolio).
- Risk-aware opportunity ranking that incorporates listing-level red-flag screening, exposes client-risk signals and questions, and discounts risk impact when evidence coverage is sparse.
- Model router: Ollama by default; OpenAI only when explicitly configured.
- Proposal draft generation with factual-profile context and safe fallback template.
- Explicit approval records and audited state transitions.
- Human review required before an application can be marked approved for external submission.
- No external submission connector is activated by default.
- Marketplace readiness endpoint explicitly reports live API verification and submission capability; settings cannot mark a provider API as configured.
- Tests for scoring, API auth, approval guardrails, retrieval and specialist functions.
- Project task and milestone CRUD with user/project ownership checks.
- Saved RSS sources and authenticated n8n-triggered scheduled discovery.
- Evidence-backed client research records with explicit confidence labels.
- Portfolio PDF/TXT/Markdown extraction and lexical cosine search.
- Invoice PDF export (record only; not proof of payment).
- Telegram test notifications and authenticated n8n event ingestion.
- Feedback capture and outcome aggregation for future learning.
- Portfolio-to-opportunity fit intelligence: deterministic profile-skill overlap, indexed portfolio evidence, potential gaps, evidence excerpts, and missing-data-aware listing quality diagnostics; all read-only and user-scoped.
- 30/90/180-day source activity comparisons for opportunity intake, proposal creation, submitted applications, recorded outcomes and manually logged payment receipts/refunds. The view is explicitly period activity, not same-cohort conversion.
- Durable LangGraph multi-agent analysis across opportunity matching, client research, project delivery, invoice finance, proposal strategy and client communication planning.
- SQL-backed per-agent checkpoints, resumable failed runs, three-attempt limit, per-user idempotency and stale-worker recovery.
- Evidence-linked business recommendations, proposal draft previews, portfolio-grounded communication plans and a `/agent-workflows` monitoring page; all external actions remain human-controlled.
- Per-agent duration telemetry and checkpoint summaries that avoid returning raw account snapshots from the workflow detail endpoint.
- Workflow cancellation with checkpoint fencing, structured failure labels, per-user operational metrics and dry-run-first retention cleanup.
- Agent-node failure telemetry and offline RAG citation/claim-grounding evaluation with a synthetic smoke dataset.
- Opt-in PostgreSQL and Redis/RQ integration checks; run them only against isolated test services.
- RAG evaluation validates evidence IDs against the retrieved evidence set and rejects unknown citations in its offline support assessment.
- Opportunity intelligence v2 combines current profile match, freshness, historical outcomes and a small evidence-confidence-weighted risk component; it does not treat missing client evidence as proof of safety.
- Benchmark dataset structure is validated before scoring; human-reviewed datasets require reviewer provenance metadata.
- Full CI provisions PostgreSQL/pgvector and Redis, runs migrations and backend integration tests, evaluates the RAG smoke fixture, and typechecks/builds the frontend.

## Deliberately not represented as complete

- Upwork, Freelancer, LinkedIn, Contra and PeoplePerHour live connectors. These require separate API access, OAuth credentials, platform terms review and provider-specific implementation. The connector interface and source registry are provided; Manual, RSS/Atom and configured public JSON intake work now.
- Automatic email sending, platform proposal submission, payment collection or contract acceptance. The app stores approval and application state but does not execute those actions.
- Always-on free cloud workers or guaranteed 24/7 monitoring. Free hosting sleeps/restarts and local Ollama requires your own computer.
- Production-grade multi-tenant SaaS compliance, independent security audit, or guaranteed model accuracy.

## Documentation

- `docs/ARCHITECTURE.md` — components and data flow
- `docs/INSTALLATION.md` — local installation
- `docs/ENVIRONMENT.md` — every environment variable and API key setup
- `docs/GITHUB_DEPLOYMENT.md` — GitHub, Vercel, Render and Neon deployment\n- `docs/FINAL_DEPLOYMENT_GUIDE_5.41.md` — complete v5.41 GitHub, environment, free-tier, Render/Vercel, migration and smoke-test runbook
- `docs/API.md` — API routes
- `docs/SECURITY.md` — security boundaries
- `docs/TESTING.md` — test and release checks
- `docs/CONNECTORS.md` — connector status and integration requirements
- `docs/ROADMAP.md` — remaining work
- `docs/RAG_BENCHMARK_GUIDE.md` — safe benchmark creation, human review and metric interpretation
- `docs/UPGRADE_0.2.md` — this release
- `docs/RELEASE_CHECKLIST.md` — what was and was not verified

## Important

Never commit `.env`, provider API keys, OAuth secrets, database passwords, JWT secrets, or user data. Rotate any secret that is accidentally committed.

## Release notes

### v5.21.0

Capacity-aware opportunity pursuit planning compares estimated job effort and deadlines with weekly capacity and recorded active-project workload. Untracked projects and missing effort/deadline data are explicitly surfaced. See `docs/UPGRADE_5.20_TO_5.21.md`.

### v5.20.0
- Added `GET /api/v1/analytics/opportunity-fit`, scoped to the authenticated user's opportunities, profile, portfolio chunks and source documents.
- Scores profile skill overlap, portfolio-text support and service alignment with weights renormalized over available evidence; absent profile/portfolio data withholds the score instead of assuming a mismatch.
- Returns potential skill gaps, up to three ranked portfolio excerpts, confidence, deterministic reasons and a separate listing-completeness score with explicit data coverage.
- Business Intelligence now includes a portfolio-to-opportunity fit section with match summaries and expandable evidence excerpts.
- No schema migration, no new dependency, no marketplace scraping or automated client action.
- Verification details: `docs/UPGRADE_5.19_TO_5.20.md` and `docs/RELEASE_5.20_VERIFICATION.md`.

### v5.19.0
- Added `GET /api/v1/analytics/source-cohorts` to group opportunities by discovery date and follow those same leads through proposals, submitted applications, latest decided outcome, project creation and recorded cash.
- Cohort cash is net recorded receipts less refunds, attributed only through invoice → project → originating opportunity; currencies remain separate.
- Business Intelligence now displays cohort conversion alongside period activity trends.
- Recent cohort maturity, latest-feedback policy, missing timestamps and manual-ledger limitations are disclosed.
- No schema migration or new dependency; all records remain user-scoped.
- See `docs/UPGRADE_5.16_TO_5.17.md` and `docs/RELEASE_5.17_VERIFICATION.md`.

### v5.16.0
- Added `GET /api/v1/analytics/source-trends` for rolling 30/90/180-day source activity.
- Uses each event’s own timestamp; payment value comes only from recorded receipt/refund ledger events linked invoice → project → originating opportunity.
- Added selectable 30/90/180-day trend table to Business Intelligence.
- No schema migration or new dependency.
- See `docs/UPGRADE_5.15_TO_5.16.md` and `docs/RELEASE_5.16_VERIFICATION.md`.


Release 3.1 adds browser-based regression coverage for the landing/authentication error path and unauthenticated route guards, plus PostgreSQL backup/restore helpers and a deployment health probe. These checks improve operational confidence but are not a security audit or a production certification. See `docs/RELEASE_3.1_VERIFICATION.md`.
See `docs/RELEASE_2.5_PROPOSAL_COMMUNICATION_AGENTS.md`, `docs/UPGRADE_2.4_TO_2.5.md` and `docs/RELEASE_2.5_VERIFICATION.md` for current release details. The ZIP manifest records file hashes.


## Release 0.3 — Background workers and hybrid retrieval
This release adds Redis/RQ queued RSS discovery, persistent background job status, chunked portfolio documents, optional Ollama/OpenAI embeddings, cosine similarity ranking and lexical fallback. See `docs/UPGRADE_0.3.md`.


## Release 0.4

See [retrieval and ingestion hardening](docs/SECURITY_AND_RETRIEVAL_0.4.md) and the [verification checklist](docs/RELEASE_0.4_VERIFICATION.md). PostgreSQL deployments use pgvector cosine retrieval with lexical fallback.


## Release 0.5

See [profile and matching](docs/RELEASE_0.5_PROFILE_MATCHING.md) and [verification steps](docs/RELEASE_0.5_VERIFICATION.md). This release adds profile-aware matching, a transparent six-part score and non-binding price guidance.


## Release 0.6

Client Research & Risk Intelligence adds opportunity-linked evidence records, transparent risk screening, evidence coverage, saved reports and client questions. See `docs/RELEASE_0.6_CLIENT_RISK_INTELLIGENCE.md`.


## Release 0.7

Multi-source discovery supports RSS/Atom and public JSON feeds, URL-based cross-source deduplication, freshness tracking and source provenance. See `docs/RELEASE_0.7_MULTI_SOURCE_DISCOVERY.md`.


## Release 0.8 — Durable agent workflows

Adds SQL-backed LangGraph node checkpoints, resumable failed runs, profile-aware pricing advice, proposal generation within the workflow, and a durable human-approval pause/resume. No external proposal submission occurs. See `docs/RELEASE_0.8_DURABLE_WORKFLOWS.md`.


## Release 0.9 — Source health and evidence provenance

Adds per-source health metrics, exponential retry/backoff for failing feeds, and provenance metadata for client research evidence. It does not independently verify client claims or integrate official freelance marketplaces. See `docs/RELEASE_0.9_SOURCE_HEALTH_AND_EVIDENCE.md`.


## Release 1.0 — Explainable Opportunity Intelligence

Adds a personalized smart-ranking endpoint and dashboard controls. Ranking combines 70% existing profile match, 20% freshness and 10% smoothed user feedback from similar categories. It is a prioritization aid, not a win-probability prediction. See `docs/RELEASE_1.0_OPPORTUNITY_INTELLIGENCE.md`.


## Release 1.1 — Delivery & Revenue Intelligence

Adds a delivery-plan preview, project time tracking, invoice due/overdue summaries and manually recorded proposal outcome analytics. Apply database migration `0010_delivery_revenue`. See `docs/RELEASE_1.1_DELIVERY_REVENUE.md` and `docs/RELEASE_1.1_VERIFICATION.md`.


## Release 1.2 — Pricing Intelligence & Project Profitability

Adds explainable personalized pricing recommendations, proposal price/outcome segments and project profitability summaries using existing records. No database migration is required. See `docs/RELEASE_1.2_PRICING_LEARNING.md` and `docs/RELEASE_1.2_VERIFICATION.md`.


## Release 1.3 — Email intake & client communication

Release 1.3 adds a tenant-scoped client inbox, deterministic message classification, conservative reply drafts, explicit approval states, and follow-up reminders. Provider labels are metadata only: Gmail/Outlook OAuth, inbox sync, and outbound sending are not enabled in this release. Approved drafts are saved as `approved_not_sent`; no email is transmitted. Apply database migrations with `alembic upgrade head`. See `docs/RELEASE_1.3_EMAIL_COMMUNICATION.md` and `docs/RELEASE_1.3_VERIFICATION.md`.


## Release 1.4
Gmail and Microsoft Outlook OAuth integration, encrypted provider tokens, recent inbox sync, hash-bound reply approvals and explicit approved sending. See `docs/RELEASE_1.4_EMAIL_PROVIDER_INTEGRATION.md` and `docs/INSTALLATION.md` for OAuth setup and limitations.


## Release 1.5
Communication intelligence adds contextual reply drafting using portfolio retrieval and prior client context, explainable urgency/sentiment signals, user-confirmed project matching, and advisory follow-up reminders. Read `docs/RELEASE_1.5_COMMUNICATION_INTELLIGENCE.md` and `docs/RELEASE_1.5_VERIFICATION.md`.


## Release 1.6 marketplace foundation
- Provider capability/status view and `/marketplaces` page.
- Per-user marketplace readiness settings (non-secret metadata only).
- Application pipeline linked to opportunities and proposals.
- SHA-256 hash-bound explicit approval, manual submission recording, outcome tracking and audit history.
- Official provider documentation and access limitations are recorded. No scraping or automated marketplace submission.

See `docs/RELEASE_1.6_MARKETPLACE_FOUNDATION.md` and `docs/RELEASE_1.6_VERIFICATION.md`.


## Release 1.7 — Delivery and Finance
The `/delivery` workspace manages project deliverables, versioned revisions, exact-version internal review, manual handover recording, milestone invoice schedules and deterministic cash-flow summaries. Invoice creation requires schedule approval and does not email clients or initiate payment. See `docs/RELEASE_1.7_DELIVERY_FINANCE.md` and `docs/RELEASE_1.7_VERIFICATION.md`.


## Release 1.8 — Business Intelligence
The `/analytics` workspace reports conversion funnel, source performance, attributed paid revenue, capacity, project profitability and an earnings outlook. Project revenue attribution requires an explicit project-to-opportunity link. Weighted pipeline is hidden until at least five decided feedback outcomes exist. See `docs/RELEASE_1.8_BUSINESS_INTELLIGENCE.md`.


## Release 2.0 — Unified Business Workspace
The `/workspace` view connects saved records across discovery, sales, delivery and finance. It includes per-user operating goals, explainable alerts for overdue work and pending approvals, and deterministic evidence-backed next-action suggestions. It does not automate external actions. Apply migration `0017_business_workspace`. See `docs/RELEASE_2.0_BUSINESS_WORKSPACE.md`, `docs/RELEASE_2.0_VERIFICATION.md` and `docs/UPGRADE_1.8_TO_2.0.md`.


## Release 2.1 — Grounded AI Business Coach
The `/coach` page and authenticated `/api/v1/coach/ask` endpoint answer questions using tenant-scoped opportunities, projects, invoices, tasks and relevant portfolio chunks. Answers return source excerpts and generation mode; model unavailability triggers an explicit non-AI fallback. This is advisory intelligence, not an autonomous execution agent. Apply migration `0018_grounded_business_coach`. See `docs/RELEASE_2.1_GROUNDED_AI_COACH.md`, `docs/RELEASE_2.1_VERIFICATION.md` and `docs/UPGRADE_2.0_TO_2.1.md`.


## Release 2.2 — Evidence-linked AI Action Planner
The `/agent` page and authenticated `GET /api/v1/agent/action-plan` endpoint generate a read-only prioritized work queue from overdue invoices, project deadlines, due tasks, follow-up reminders and stale opportunities. Every item links to its source record and is marked as requiring human approval. No external or irreversible action is executed. No database migration is required. See `docs/RELEASE_2.2_AGENT_ACTION_PLANNER.md`, `docs/RELEASE_2.2_VERIFICATION.md` and `docs/UPGRADE_2.1_TO_2.2.md`.


## Release 2.3 — Hybrid RAG and Retrieval Quality
The portfolio retrieval pipeline now combines lexical and embedding rankings using weighted reciprocal-rank fusion, applies diversity-aware MMR ordering, and exposes modality scores/ranks. The business coach attempts bounded query embeddings and falls back to lexical retrieval when unavailable. Coach responses include source-ID citation validation, and offline evaluation reports hit rate, precision@K, recall@K, MRR@K and nDCG@K. Citation-ID checks do not independently prove factual entailment. No database migration is required. See `docs/RELEASE_2.3_HYBRID_RAG.md`, `docs/RELEASE_2.3_VERIFICATION.md` and `docs/UPGRADE_2.2_TO_2.3.md`.


## Release 2.4 — Durable Multi-Agent Workflows

Release 2.4 adds a resumable, SQL-checkpointed LangGraph workflow coordinating opportunity matching, client evidence review, delivery analysis and finance analysis. Start and monitor runs at `/agent-workflows`. The workflow is read-only and requires human approval for external actions. See `docs/RELEASE_2.4_MULTI_AGENT_WORKFLOWS.md` and `docs/UPGRADE_2.3_TO_2.4.md`.

## Upgrade notes

See `docs/UPGRADE_2.7_TO_2.8.md` and `docs/RELEASE_2.8_RAG_VALIDATION.md` before deploying v2.8.

## v2.7 evaluation and upgrade

See `docs/RELEASE_2.7_RAG_RELIABILITY.md` and `docs/UPGRADE_2.6_TO_2.7.md`. The grounding evaluator is a lexical proxy, not a semantic judge.


## Release 2.8 — RAG citation integrity and production validation

Release 2.8 strengthens the offline RAG evaluator: unknown evidence IDs are reported and cannot be counted as supported claims; benchmark schemas, unique IDs, labels and citation references are checked before evaluation. A benchmark marked human-reviewed must include reviewer, review date and review method metadata. CI validates the migration chain using PostgreSQL/pgvector, runs Redis/RQ integration checks and backend tests, then typechecks and builds the Next.js frontend. The bundled examples remain synthetic smoke tests; the lexical evaluator is not semantic entailment and its perfect toy-fixture score is not a production accuracy claim. No database migration is required. See `docs/RELEASE_2.8_RAG_VALIDATION.md`, `docs/RELEASE_2.8_VERIFICATION.md` and `docs/UPGRADE_2.7_TO_2.8.md`.


## Current release

Version 2.9.0 adds validated retrieval ranking benchmarks and stricter exact-content proposal approval checks. See `docs/RELEASE_2.9_RETRIEVAL_APPROVAL_RELIABILITY.md` and `docs/UPGRADE_2.8_TO_2.9.md`.


## v3.0 production preflight

Before deploying the API with `ENVIRONMENT=production`, configure a strong unique
`SECRET_KEY`, PostgreSQL `DATABASE_URL`, Redis `REDIS_URL`, HTTPS `FRONTEND_URL`,
and explicit HTTPS `CORS_ORIGINS`. If Google or Microsoft email OAuth is enabled,
also configure `OAUTH_ENCRYPTION_KEY`.

Run the configuration-only preflight from `backend/`:

```bash
ENVIRONMENT=production python scripts/production_preflight.py
```

The command prints configuration rule names only and never prints secret values.
The API also applies the same validation during production startup.


## Current release — 3.0.0

v3.0 adds approval journey regression coverage, proposal/approval/workflow row
locking with a consistent lock order, production startup configuration checks,
and a configuration-only preflight command. See
`docs/RELEASE_3.0_PRODUCTION_READINESS.md` and
`docs/UPGRADE_2.9_TO_3.0.md`.


## Operations quick checks

- API health: `python backend/scripts/check_health.py --url https://YOUR-API/health`
- PostgreSQL backup: `DATABASE_URL=... bash ops/backup_postgres.sh`
- PostgreSQL restore: use a verified backup against a confirmed target only, with `CONFIRM_RESTORE=YES`; see `docs/OPERATIONS_3.1.md`.
- Frontend browser regression: `cd frontend && npm install && npx playwright install chromium && npm run test:e2e`

Backups contain personal and financial records. Encrypt them, restrict access, keep copies outside the application host, and periodically test restores in an isolated database.


## Release 3.2 — tenant isolation and quality gates

Release 3.2 expands account-isolation regression coverage across opportunities, projects, invoices, tasks, milestones and client research; adds an authenticated browser login journey; introduces dependency vulnerability scanning in CI; and adds controlled read-only k6 smoke testing guidance plus a human-reviewed retrieval benchmark protocol. These additions are test and operational foundations, not a security audit or measured capacity certification. See `docs/RELEASE_3.2_VERIFICATION.md`.


## Release 3.3 — API protection and readiness

Release 3.3 adds Redis-backed per-actor request limits for authentication, AI/search and general API routes, plus a dependency-aware `/ready` endpoint. Production rate limiting fails closed when Redis is unavailable. Configure the `RATE_LIMIT_*_PER_MINUTE` values and verify `/ready` after deployment. See `docs/RATE_LIMITING_AND_READINESS_3.3.md` and `docs/RELEASE_3.3_VERIFICATION.md`.


## Release 3.4 — AI usage quotas and abuse monitoring

Release 3.4 adds durable per-account AI operation accounting and daily/monthly quotas for proposal generation, client email reply drafting, and the business coach. Defaults are 20 AI operations/day and 300/month; configure `AI_QUOTA_DAILY_CALLS` and `AI_QUOTA_MONTHLY_CALLS`. View usage at `GET /api/v1/usage/ai`. Usage records store operation, provider and character counts. They do not claim token counts or monetary cost: those are unavailable unless provider usage and pricing are verified. Quota exhaustion is recorded as an account-scoped abuse event.

Run `alembic upgrade head` before deploying. See `docs/UPGRADE_3.3_TO_3.4.md` and `docs/AI_USAGE_QUOTAS_3.4.md`.


## Release 3.5 — usage history and persistent abuse signals

Release 3.5 extends the 3.4 account-scoped AI quota foundation with recent usage-event history in `GET /api/v1/usage/ai` and a privacy-safe account-scoped security view at `GET /api/v1/security/abuse-events`. Authenticated requests rejected by the Redis rate limiter now create a persistent `rate_limit_exceeded` event, deduplicated per account/category for 60 seconds in Redis. Anonymous IP addresses and request payloads are not written to the abuse table. The new endpoint exposes only the authenticated account's own events. No schema migration is required. See `docs/AI_USAGE_AND_ABUSE_MONITORING_3.5.md` and `docs/UPGRADE_3.4_TO_3.5.md`.


## Release 3.6 — usage reporting and safe abuse-telemetry retention

Release 3.6 adds `GET /api/v1/usage/ai/report?days=30`, an authenticated account-scoped report grouped by AI operation and provider, with daily call counts and character totals. It deliberately does not invent token counts or monetary costs. It also adds `backend/scripts/cleanup_abuse_events.py`; the command previews eligible records by default and deletes only when `--apply` is supplied. No database migration is required. See `docs/USAGE_REPORTING_AND_RETENTION_3.6.md` and `docs/UPGRADE_3.5_TO_3.6.md`.


## Release 3.7 — agent workflow quota and tenant regression foundation

Agent workflow starts now consume one account-scoped AI operation quota event (idempotent replays do not). This is workflow-operation accounting, not internal model token/cost metering. Focused tenant regression tests cover workflow ownership. See `docs/AGENT_WORKFLOW_USAGE_AND_TENANCY_3.7.md` and `docs/UPGRADE_3.6_TO_3.7.md`.


## Release 3.8 — tenant-isolation coverage expansion

Adds authenticated two-account API regression tests for delivery records, time entries, invoice schedules, email intake, follow-up reminders, and portfolio document/search isolation. No schema migration is required. See `docs/TENANT_ISOLATION_COVERAGE_3.8.md` and `docs/UPGRADE_3.7_TO_3.8.md`.


## Release 4.0 — OAuth lifecycle and tenant reliability hardening

Expands authenticated tenant regression coverage for marketplace, email integration metadata, deliverable revisions, invoice schedules, and workflow checkpoints. Portfolio document and semantic-search embeddings now consume the existing account quota and successful embeddings are reflected in usage reports. Lexical fallback remains available. No database migration or new environment variables are required.


## Release 4.1 — lifecycle integrity and mutation concurrency

- Added authenticated API lifecycle regressions for marketplace application proposal-hash approval, manual submission tracking and audit ownership.
- Added invoice schedule tests for approval-hash validation, approval-before-issue, duplicate invoice prevention and cross-account rejection.
- Added deliverable lifecycle tests for review-hash validation, internal approval, manually recorded handover, client acceptance and post-delivery edit locking.
- Added durable workflow resume tests for account ownership, current proposal approval and checkpoint persistence.
- Added row-level locks to marketplace status changes and deliverable mutation/review/handover transitions where supported by the database.
- Connected the backend test database engine to the isolated `TEST_DATABASE_URL` supplied by full CI; production ignores this test-only override, and PostgreSQL tests now target the migrated CI database rather than silently falling back to local SQLite.
- No schema migration or new environment variables are required. Marketplace submission, email sending, client delivery and payments remain human-controlled.


## Release 4.2 — Redis worker reliability and CI integration

- Added real Redis/RQ integration tests using the ephemeral Redis service already provisioned by full CI.
- Added a real `SimpleWorker` smoke test that executes an enqueued job and verifies its persisted result.
- Added authenticated agent-workflow queue tests for idempotent enqueue and job visibility.
- Added simulated Redis enqueue-outage coverage: the workflow is marked failed with a safe queue error, then retry enqueues it after Redis is restored.
- Full CI now supplies its isolated `TEST_REDIS_URL` as `REDIS_URL` during backend integration tests, exercising the same Redis service for rate limiting and queue operations.
- Fixed the frontend `package.json` trailing escaped-newline artifact so it is valid JSON for npm.
- No schema migration or new runtime dependency is introduced. Worker tasks remain read-only/recommendation workflows; external actions remain human-controlled.


## Release 4.3 — authenticated journey and recovery verification

- Added a deterministic authenticated API journey regression: opportunity → AI proposal draft (provider stub) → explicit human approval → ready-for-manual-submission → project attribution → deliverable review → recorded handover reference → unpaid invoice.
- Added `ops/verify_backup_restore.sh` to validate backup checksums and PostgreSQL archive structure, with an explicit opt-in and distinct-target guard before any restore.
- Added a manually triggered GitHub Actions k6 smoke workflow that accepts only HTTPS hosts clearly marked as staging, requires an explicit staging confirmation, and uploads the summary artifact.
- No production deployment, live client handover, marketplace submission, email or payment is performed by the new tests.


## Release 4.4 — worker fencing and dependency evidence

- Added a deterministic stale-worker checkpoint fencing regression.
- Added Redis/RQ coverage proving a cancelled queued workflow is a no-op when picked up by a worker.
- CI now retains JSON dependency audit reports as a downloadable artifact for 30 days, even when npm audit reports findings.
- Pinned Playwright to an exact dependency version.
- No schema migration or new runtime dependency.


## Release 4.5 — deployment configuration and go-live hardening

- Docker Compose uses a one-shot migration service before API/worker startup.
- API Docker image no longer runs migrations on every restart.
- Worker checks Redis connectivity at startup.
- Production preflight rejects localhost Ollama endpoints and missing AI provider configuration.
- Frontend production API origin validation is included in CI.
- See `docs/DEPLOYMENT_PRODUCTION.md` for the Vercel + Render deployment sequence and required environment variables.
- See `ops/deploy_preflight.sh` for the controlled production preflight/migration command.


### v4.5 release status
The release includes deployment configuration and go-live runbooks, but provider-side deployment, full CI, dependency audit, Docker builds, staging load, backup restore and human-reviewed RAG checks must still be completed. See `docs/RELEASE_4.5_VERIFICATION.md` and `docs/PRODUCTION_RELEASE_GATE.md`; do not treat packaging verification as production certification.


## Release 4.6.0

This release adds a secret-safe ZIP packaging utility and stronger PostgreSQL backup/restore validation. See `docs/UPGRADE_4.5_TO_4.6.md` and `docs/RELEASE_4.6_VERIFICATION.md`. The release is not production-certified until all external release gates pass.


## Release 4.7.0

The Action Planner now covers the full recorded lifecycle: opportunity pipeline, client follow-ups, proposal approvals, marketplace submission tracking, project milestones, deliverable reviews and invoice schedules. The recommendations remain account-scoped and require human decisions. See `docs/UPGRADE_4.6_TO_4.7.md` and `docs/RELEASE_4.7_VERIFICATION.md`.


## Release 4.8.0

Adds Client Relationship Management, project-to-client linking, client activity history and human-controlled scope-change approvals. Apply Alembic revision `0022_client_crm_scope` before deploying the v4.8.0 API. See `docs/UPGRADE_4.7_TO_4.8.md` and `docs/RELEASE_4.8_VERIFICATION.md`.

## Release 5.0.0 — immutable contract and delivery history

Release 5.0.0 adds immutable client contract/SOW revision snapshots with SHA-256 parent links and a revision-chain integrity check, plus per-revision deliverable acceptance/change-request history. Existing contract records are migrated as their latest available snapshot; versions that were never stored cannot be reconstructed. Existing client decision audit entries are copied with a historical-migration marker. See `docs/UPGRADE_4.9_TO_5.0.md` and `docs/RELEASE_5.0_VERIFICATION.md` before deploying.


## Release 5.1.0 — invoice payment reconciliation

v5.1.0 adds an append-only manual payment evidence ledger for invoice receipts, refunds and dispute lifecycle events. It calculates net paid and outstanding amounts without mixing currencies, and client profitability uses net ledger receipts where a ledger exists. This is not a payment gateway or bank integration. See `docs/UPGRADE_5.0_TO_5.1.md` and `docs/RELEASE_5.1_VERIFICATION.md`.


## Release 5.2.0 — client profitability and business intelligence

v5.2.0 adds manually recorded direct client costs, currency-separated profitability with labor-cost proxies, an explainable client relationship-health heuristic, and a Client Insights dashboard. No banking or accounting integration is implied. See `docs/UPGRADE_5.1_TO_5.2.md` and `docs/RELEASE_5.2_VERIFICATION.md`.


## Release 5.3.0 — Opportunity Intelligence

v5.3.0 adds current-profile opportunity rescoring, explainable ranking and eligibility warnings, source provenance, a persisted shortlist/review workflow, and the Opportunity Intelligence page. Proposal generation remains draft-only and client-risk screening remains a separate manual assessment. Marketplace readiness settings are not live API connections; provider-specific API clients are not activated in this release. See `docs/UPGRADE_5.2_TO_5.3.md` and `docs/RELEASE_5.3_VERIFICATION.md`.


## Release 5.4.0 — marketplace integration readiness

v5.4.0 adds fail-closed Upwork/Freelancer adapter contracts, a provider readiness endpoint, and safeguards against treating a manually selected setting as a verified marketplace connection. No marketplace API calls or proposal submissions are activated. See `docs/UPGRADE_5.3_TO_5.4.md` and `docs/RELEASE_5.4_VERIFICATION.md`.


## Release 5.5.0 — encrypted marketplace credential vault

v5.5.0 adds encrypted per-user marketplace credential storage, metadata-only credential status, and owner-initiated local credential deletion. Credential storage is explicitly marked `stored_unverified`; it does not mean OAuth succeeded or that a provider API is connected. At that release point, no marketplace OAuth callback or token refresh was included; v5.6.0 adds the Upwork OAuth foundation. No Upwork GraphQL client, remote revocation automation, or proposal submission is included. Apply migration `0028_marketplace_credential_vault` after a verified backup. See `docs/UPGRADE_5.4_TO_5.5.md` and `docs/RELEASE_5.5_VERIFICATION.md`.


## Release 5.6.0 — Upwork OAuth authorization foundation

v5.6.0 adds an Upwork authorization-code flow with PKCE, one-time server-side state, encrypted token persistence, token refresh, and metadata-only credential status. Configure the client ID, secret, exact registered callback URL, approved scopes, and `OAUTH_ENCRYPTION_KEY`. Successful token exchange is labeled `stored_unverified`; no account identity lookup or Upwork GraphQL query is performed. Freelancer.com remains a documented developer API with no app-specific auth flow enabled. Proposal submission remains disabled. See `docs/UPGRADE_5.5_TO_5.6.md` and `docs/RELEASE_5.6_VERIFICATION.md`.


## Release 5.7.0 — Upwork read-only opportunity discovery

v5.7.0 adds an official Upwork GraphQL `marketplaceJobPostingsSearch` client. After the user has completed Upwork OAuth and the app's API key has the required approved read-only marketplace scope, the Marketplace Integrations page can search listings, import them into the user's opportunity pipeline, score them against the saved profile, deduplicate repeated records, and load additional pages using provider cursors. The connection is marked `api_verified` only after a successful authenticated GraphQL request. The app does not invent browser URLs or payment-verification claims when those fields are absent from the API response. Upwork listing content is redacted after 22 hours to respect the provider's cache limit; discovery remains disabled until an hourly retention job is configured and `UPWORK_CACHE_RETENTION_ENABLED=true` is set. The adapter is read-only: it does not submit proposals or perform any other marketplace mutation. Freelancer.com remains pending a separately verified authorization and API implementation. See `docs/UPGRADE_5.6_TO_5.7.md` and `docs/RELEASE_5.7_VERIFICATION.md`.


## Release 5.8.0 — Saved searches and scheduled discovery

v5.8.0 adds account-scoped saved Upwork keyword searches, configurable 6/12/24-hour intervals, pause/resume/delete, manual run-now, and a scheduled runner (`python -m app.scheduled_discovery`). The runner is read-only and imports through the existing scoring/deduplication pipeline. Configure the included `Scheduled Upwork saved searches` GitHub Actions workflow with `PRODUCTION_DATABASE_URL`, `OAUTH_ENCRYPTION_KEY`, `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`, `UPWORK_REDIRECT_URI`, and `UPWORK_SCOPES`; it checks due searches every 15 minutes. The separate hourly listing-retention workflow must remain enabled. The scheduled workflow is gated by the GitHub repository variable `UPWORK_CACHE_RETENTION_ENABLED`; leave it unset/false until both workflows are verified against staging. No proposal submission is performed. Apply migration `0029_saved_marketplace_searches`. See `docs/UPGRADE_5.7_TO_5.8.md` and `docs/RELEASE_5.8_VERIFICATION.md`.


## Release 5.9.0 — Risk-aware opportunity intelligence

Adds listing-level risk screening to the opportunity intelligence feed. The rank now uses 65% current profile match, 20% freshness, 10% similar historical outcomes and 5% evidence-confidence-weighted risk quality. Risk findings include source-linked rule IDs, questions to ask and explicit limitations. Sparse evidence is neutral-weighted; no low risk score is presented as a guarantee of client safety. No database migration or new environment variable is required. See `docs/RELEASE_5.9_VERIFICATION.md` and `docs/UPGRADE_5.8_TO_5.9.md`.


## Release 5.10.0 — Portfolio-grounded proposal intelligence

- Retrieves relevant case-study chunks from the signed-in user's portfolio before proposal generation.
- Exposes a read-only evidence preview at `GET /api/v1/proposals/intelligence/{opportunity_id}`.
- Uses existing hybrid retrieval and lexical fallback; no new vector store or schema migration.
- Returns evidence source IDs, coverage indicators and limitations with generated proposal responses.
- Proposal instructions prohibit unsupported client, project, metric, certification and outcome claims.
- External proposal submission and client communication remain explicitly approval-gated/manual.

## Release 5.16.0 — Proposal factual-claim review

Adds a deterministic review layer to proposal generation. It flags potentially high-risk factual statements (experience duration, quantified outcomes, credentials, named clients/employers and specific delivery claims), compares their wording with retrieved portfolio excerpts, and returns review findings in the generation response. The opportunity-intelligence page displays those findings before the user opens the proposal for editing and approval. Lexical overlap is not proof, and this is not a truth detector; verify original sources and remove unsupported statements. No database migration or new environment variable is required. No external submission or client communication is triggered. See `docs/RELEASE_5.11_VERIFICATION.md` and `docs/UPGRADE_5.10_TO_5.11.md`.


## v5.15.0 — Proposal quality and commercial-integrity review
Adds a deterministic, transparent proposal checklist covering basic completeness, suspicious instruction-like text in listings and drafts, and quote-versus-budget inconsistencies. The API returns `quality_review` metadata; the opportunity-intelligence UI displays the score, individual checks, warnings and limitations. This is a conservative review aid—not a semantic evaluator, truth detector, quote validator across currencies, or approval mechanism. No database migration or new environment variable is required. All external actions remain explicitly human-approved. See `docs/UPGRADE_5.11_TO_5.12.md` and `docs/RELEASE_5.12_VERIFICATION.md`.


## v5.15.0 — Proposal quality regression evaluation

- Added a reproducible offline benchmark for the deterministic proposal-quality checks.
- Eight synthetic fixtures cover clean drafts, listing prompt injection, echoed injection, budget overrun, unstructured prices, empty drafts, budget-aligned quotes and negative prices.
- Reports case-level pass/fail, flag precision and recall, with explicit synthetic-data limitations.
- Run from the repository root: `python ops/evaluate_proposals.py`.
- The fixture set is synthetic and is not represented as human-reviewed, representative, or evidence of semantic accuracy.
- Evaluation is advisory only. It never approves, sends or submits a proposal.


## v5.15.0 — Evidence-aware proposal outcome intelligence

- Adds an authenticated analytics endpoint at `/api/v1/analytics/proposal-intelligence`.
- Joins the latest saved proposal and latest manually recorded feedback per opportunity to avoid counting repeated revisions/outcome edits as independent cases.
- Breaks down outcomes by opportunity source and deterministic proposal basic-check bands.
- Separates explicit wins/losses from no-response, not-relevant, client-risk and undecided records.
- Hides inferential win rates until the configurable minimum decided sample (default 5) is met; descriptive rates remain explicitly labelled.
- Adds the analytics dashboard section. No schema migration or new dependency.
- The score is a basic deterministic heuristic, not semantic quality; association is not causation.


## v5.15.0 — Source ROI and acquisition decision support

- Source performance now separates opportunities, application records, recorded submissions, wins, losses and unknown/undecided outcomes.
- Win rates are withheld until a configurable minimum decided sample (default 5) is met.
- Adds attributed project costs from manually recorded `ClientCostEntry` records only when the cost is linked to a project and the project is linked to its originating opportunity.
- Paid invoice revenue and attributed costs remain separated by currency; no exchange rates or cross-currency netting are invented.
- ROI is withheld unless positive paid revenue and positive attributed costs are both available in the same currency.
- Client-level/unlinked overhead, unpaid invoices and unlinked project revenue/costs are excluded from source ROI.
- Analytics UI shows attributed cost and ROI breakdowns by currency.
- No schema migration or new runtime dependency.


### v5.23.0 — Forward workload commitments

Project tasks now support optional estimated effort and planned start dates. The commitment planner allocates explicitly estimated work across an eight-week horizon, flags weekly overloads, and lists unscheduled tasks, missing estimates and overdue tasks. Existing task records remain valid and appear as unscheduled/unknown until updated. Apply Alembic migration `0030_task_commitment_planning` before using the new fields. See `docs/UPGRADE_5.21_TO_5.22.md` and `docs/RELEASE_5.22_VERIFICATION.md`.


### v5.24.0 — Dependency-aware delivery planning

Project tasks can now be connected with explicit finish-to-start dependencies. The backend validates ownership, project boundaries, duplicate edges and circular sequences. Business Intelligence shows the longest dependency chain using entered task-hour estimates, unknown-effort warnings and date-overlap review prompts. No task dates are automatically changed. Apply Alembic migration `0032_task_dependencies` before using dependency planning. See `docs/UPGRADE_5.23_TO_5.24.md` and `docs/RELEASE_5.24_VERIFICATION.md`.


### v5.25.0 — Capacity-aware delivery schedule recommendations

- Adds authenticated `GET /api/v1/analytics/schedule-recommendations` with a configurable 7–180 day planning horizon.
- Proposes task dates using recorded estimates, finish-to-start dependencies, profile weekly capacity and user-entered unavailable hours.
- Blocks successors when predecessor effort is unknown or predecessor scheduling fails; reports dependency cycles and missing estimates.
- Flags projected task lateness and project-level milestone impacts.
- Suggestions are read-only; task dates and client commitments are never changed automatically.


### v5.26.0 — Schedule plan governance

- Save read-only schedule recommendations as immutable, user-owned draft versions.
- Review schedule version history and approve or reject a draft explicitly.
- Approval applies recommended planned start/finish dates only; contractual due dates are never overwritten.
- A SHA-256 input fingerprint blocks approval if tasks, project state, dependencies, availability, capacity or milestones changed after draft creation.
- Rollback restores prior planned dates only when the current values still match the approved plan, protecting later manual edits.
- Migration `0033_schedule_plan_governance` adds planned finish dates and schedule plan audit records.


### v5.27.0 — Actual-versus-planned delivery intelligence

- `GET /api/v1/analytics/delivery-performance` compares task estimates with task-linked time entries and planned finish dates with recorded completion timestamps.
- Task completion timestamps are recorded on transition to `done`; reopening clears the timestamp. Historical dates are not inferred for legacy tasks.
- Business Intelligence shows project/task effort variance, schedule variance, missing time logs and sample-quality labels.
- Migration `0034_task_completion_tracking` is additive; no new dependency.


### v5.28.0 — Adaptive effort estimation

- New authenticated endpoint `GET /api/v1/analytics/adaptive-effort`.
- Recommends task effort from up to 12 similar completed tasks with task-linked time entries, using median hours and a 25th–75th percentile range.
- Shows sample size, confidence, dispersion and matched historical examples in Business Intelligence.
- No database migration or dependency change. Suggestions are read-only; no task estimate, schedule or deadline is changed automatically.
- See `docs/UPGRADE_5.27_TO_5.28.md` and `docs/RELEASE_5.28_VERIFICATION.md`.


### v5.29.0 — Delivery bottleneck and revision intelligence

- Added `GET /api/v1/analytics/delivery-bottlenecks`, scoped to the authenticated user's projects, tasks, dependencies, deliverables and revision snapshots.
- Flags review candidates using explicit dependency structure, longest-chain membership, downstream fan-out and recorded overdue dates. The score is a deterministic review priority, not a probability or causal claim.
- Summarizes deliverable revision versions, counting versions after the initial snapshot separately. Revision counts are described as activity, not proof of avoidable rework.
- Keeps closed projects and completed/cancelled tasks out of open bottleneck candidates; dependency cycles are surfaced rather than used to infer a critical path.
- Added Business Intelligence tables and focused regression tests. No schema migration or runtime dependency added.
- Release cleanup removes generated Python bytecode and test caches. Historical source, tests, migration files and release documentation are retained because they remain useful for reproducibility and upgrades.


### v5.30.0 — Client feedback and delivery quality intelligence

- `GET /api/v1/analytics/delivery-quality?minimum_sample=3` reports recorded client decisions, sample-gated acceptance rates, observed acceptance cycle time, revision-version timing associations and separately linked project scope changes.
- No client message is sent, no contract is changed and no revision is auto-classified. Historical revisions without origin metadata remain unclassified.
- Acceptance-cycle time requires both a recorded delivery handover and a later client decision timestamp for the same deliverable.


## v5.32.0 — Delivery evidence and client approval traceability

Revision snapshots can now link to the exact client feedback event or explicitly client-accepted approved scope-change record that supports a revision. Links are checked for account, project/deliverable, decision state, revision number and content hash. Linked evidence cannot be deleted while a revision references it. Historical revisions remain unlinked unless a user creates a new, properly evidenced revision.

Upgrade from v5.31.0: back up the database, deploy the source, then run `cd backend && alembic upgrade head`. The migration adds two nullable evidence-link columns and indexes/foreign keys; it does not modify historical revision evidence.


## v5.34.0 — Delivery audit integrity and revision evidence coverage

- Added per-project SHA-256 hash chaining for delivery audit events, with deterministic backfill of existing events and a persisted project head hash in migration `0037_delivery_audit_hash_chain`. All nine existing delivery/invoice-schedule audit write paths append through a project-serialized helper.
- Added authenticated `GET /api/v1/analytics/delivery-audit-integrity` to detect altered, removed or misordered stored events.
- Added authenticated `GET /api/v1/analytics/revision-evidence-coverage` to validate client-requested and approved-scope-change revision links and report missing/mismatched evidence by project and origin.
- Added both diagnostics to Business Intelligence. Hash chains are tamper-evident, not digital signatures; matching internal records do not independently prove client identity or external communication.


## v5.34.0 — Delivery Dispute and Corrective-Action Workflow
- Added account-scoped delivery issue records linked to an exact deliverable revision and optional exact client change-request event.
- Added severity, triage, assignment, corrective action, due date, resolution note and resolution evidence.
- Enforced deterministic transitions; resolution requires corrective action, a resolution summary and an evidence reference; closure is allowed only after resolution. Closed issues are immutable.
- Appended issue creation and update events to the existing per-project tamper-evident delivery audit chain.
- Added Delivery & Finance Workspace controls for recording and managing disputes.
- No client communication, contract change, invoice, or payment action is performed by this workflow.
- Database migration: `0038_delivery_issue_workflow`.


## v5.35.0 — Delivery dispute analytics and SLA review (implemented)
- Added explicit root-cause categories to delivery issue records; labels are user-entered and historical issues default to `unclassified`.
- Added authenticated `/api/v1/analytics/delivery-disputes` reporting severity/status/root-cause counts, overdue open issues, and median time-to-triage/resolution only where timestamps exist.
- Added project-level Business Intelligence views and root-cause selection in the delivery workspace.
- Overdue uses the recorded due date and current server date; elapsed-time metrics use recorded issue/audit timestamps. Metrics are descriptive operational signals, not contractual SLA guarantees.
- Migration `0039_delivery_issue_root_cause`; no new runtime dependency.


## v5.37.0 — Client-facing delivery health and change-control readiness

- Added authenticated read-only `GET /api/v1/analytics/delivery-health` with deterministic project health labels derived from recorded tasks, client decisions, delivery issues, audit-chain verification and revision-evidence coverage.
- Health labels are explainable (`on_track`, `watch`, `needs_attention`, `insufficient_data`); missing data blocks an on-track conclusion. No opaque AI score or client-risk probability is generated.
- Added per-project fact categories, review warnings and missing-data explanations. User-entered labels remain explicitly identified as such.
- Added approval-ready scope-change summaries with missing-field checks, budget/timeline impact and recorded decision status. These are for human review only and do not approve scope, amend contracts or contact clients.
- Updated Business Intelligence dashboard. No database migration or new runtime dependency is required.


## v5.38.0 — PDF client handover and project closeout readiness

- Approved immutable handover snapshots can now be rendered as a printable PDF. PDF export rejects draft snapshots and re-checks the stored snapshot hash.
- Handover snapshots now include project-linked invoice reconciliation, using manually recorded payment/refund/dispute events and currency-isolated balances.
- Added deterministic project closeout readiness checks: latest-revision client acceptance, open delivery issues, approved and client-accepted scope changes, invoice outstanding balances, payment disputes, and delivery audit integrity.
- Legacy invoice `paid` status without ledger events is explicitly disclosed as legacy status only; it is not presented as independently verified settlement.
- Added `GET /api/v1/projects/{project_id}/closeout-readiness` and `GET /api/v1/handover-snapshots/{snapshot_id}/export.pdf`.
- No new migration or runtime dependency. PDF generation uses the existing pinned ReportLab dependency. No external sharing, client notification, payment collection or automatic project closure.


## v5.39.0 — Closeout sign-off, explicit closure and retention controls

- Added immutable, versioned human closeout sign-offs bound to the approved handover snapshot hash and live closeout fingerprint.
- Sign-off revalidates current project records and closeout readiness; stale snapshots or any blocker are rejected.
- Added a separate explicit project closure action requiring the exact phrase `CLOSE PROJECT`; closure is stored as an immutable record and project status changes to `completed`.
- Added non-destructive retention planning and redaction preview endpoints. Redaction previews never modify stored snapshots.
- Delivery workspace supports sign-off, separate closure confirmation, redaction preview and retention preview.
- Added migration `0041_closeout_signoff_and_closure`.
- No client communication, automatic deletion, external sharing or payment action is performed.


## v5.39.0 closeout governance

- Append-only closeout sign-offs are bound to an approved handover snapshot hash and a live closeout fingerprint. The API rejects stale snapshots and any unresolved closeout blocker.
- Project closure is a separate explicit action requiring the exact confirmation phrase `CLOSE PROJECT`; it writes an immutable closure record and then marks the project `completed`.
- Retention planning and redaction are previews only. The original immutable snapshot is never edited or deleted by these endpoints.
- The sign-off role, note and evidence reference are user-entered metadata, not independently verified identity or client attestations. No client communication is sent.


## v5.40.0 — Post-closeout archive and project outcome review

- Added immutable, versioned project archive manifests after explicit project closure. Manifests fingerprint approved handover snapshots, closeout sign-offs, closure records, delivery audit events, revision/feedback records, disputes, scope changes, invoices, payment events, direct costs and evidence-reference strings.
- Added archive integrity verification, including the stored manifest/component hashes and existence/hash checks for the referenced approved snapshot, sign-off and closure records.
- Added downloadable JSON archive manifests. Downloads are refused if integrity checks fail.
- Added project outcome review for task planned-vs-actual finish dates, manually recorded receipts/refunds/direct costs by currency, billable time estimates, latest-revision acceptance coverage and delivery issue history.
- Added user retention-policy review requests with explicit approval/rejection. Approved retention periods drive preview dates only; no automatic deletion or archiving occurs.
- No external evidence files are copied into archives. Evidence reference hashes fingerprint reference strings only.
- Migration `0042_post_closeout_archive_and_retention`.


## v5.41.0 — Archive lifecycle and recovery readiness

- Added complete verified archive ZIP bundles containing the immutable archive manifest, approved handover snapshot JSON, rendered handover PDF, project outcome JSON, verification report, README and per-file SHA-256 checksums.
- Added detailed verification reports for manifest hash, component hash, approved snapshot, closeout sign-off, closure linkage and evidence-reference strings.
- Added append-only archive supersession links. Old manifests are never rewritten or deleted.
- Added a human-run recovery rehearsal record with required evidence references for archive download, checksum verification, database backup, restore test, API health and frontend smoke test.
- Recovery rehearsal records are operator-reported evidence; the application does not run database restore operations.
- Added migration `0043_archive_bundle_and_supersession`.
- Updated release/deployment documentation and production readiness checklist.


## v5.42.0 — Production launch stabilization

- Protected system diagnostics endpoint: `GET /api/v1/system/diagnostics` (requires `X-Diagnostics-Key`).
- Checks database, Alembic revision, Redis, RQ queued/started/failed jobs, worker heartbeat and AI provider status without exposing secrets.
- Worker publishes a per-process Redis heartbeat with 90-second expiry; diagnostics can detect missing/stale workers and multiple worker instances.
- Production `/ready` returns 503 when PostgreSQL, Redis, migration head or production configuration is invalid.
- Public registration defaults to disabled in code; enable only during initial account setup and disable afterwards.
- No new migration. Current expected Alembic head remains `0043_archive_bundle_and_supersession`.


## v5.42.0 deployment verification

See `docs/FINAL_DEPLOYMENT_GUIDE_5.42.md` for the current rollout steps and `docs/RELEASE_5.42_VERIFICATION.md` for the exact checks and remaining blockers. `DIAGNOSTICS_API_KEY` is optional but recommended for operator-only system diagnostics. The code default for `PUBLIC_REGISTRATION` is now disabled.


## v5.43.0 — Account security and production authentication

- Email verification with expiring, single-use links; token digests only are stored.
- Password reset with generic account-enumeration-safe response, 30-minute single-use tokens and session invalidation.
- Password change with current-password verification and revocation of all prior sessions.
- Database-backed JWT sessions (`jti`) with single-session revocation, logout and logout-all.
- Password hashes use `bcrypt_sha256`; existing bcrypt hashes remain verifiable.
- Account-security frontend at `/security`, plus verification and reset-link handling on the login screen.
- Authentication endpoints share the stricter authentication rate-limit bucket.
- SMTP delivery is configurable. Production requires email verification and SMTP settings.
- Migration `0044_account_security` adds `users.email_verified`, `auth_sessions` and `email_action_tokens`.


## v5.44.0 — Multi-factor authentication and login protection

- TOTP authenticator support using RFC 6238 (no external TOTP API).
- MFA secrets encrypted at rest using Fernet with a purpose-derived key from `SECRET_KEY`.
- One-time SHA-256-hashed recovery codes; each can be used once.
- MFA login challenge tokens are short-lived (default 5 minutes), database-backed and single-use, with an attempt limit.
- TOTP time-step replay protection: a previously accepted authenticator time step cannot be reused.
- Login lockout after repeated failed passwords (default 8 failures / 15 minutes).
- Login and MFA verification remain within the existing Redis-backed authentication rate-limit bucket.
- No external paid API or subscription is required for TOTP.

Migration `0045_mfa_and_login_lockout` follows `0044_account_security`. Preserve `SECRET_KEY` across deployments: changing it invalidates JWTs and makes existing encrypted MFA secrets unreadable.


## v5.44 deployment documents
- `docs/FINAL_DEPLOYMENT_GUIDE_5.44.md` — GitHub, Render, Vercel, SMTP, MFA setup and break-glass recovery.
- `docs/UPGRADE_5.43_TO_5.44.md` — upgrade sequence and migration.
- `docs/RELEASE_5.44_VERIFICATION.md` — test results and remaining release gates.


## v5.45.0 — Security hardening and production readiness

- Sensitive MFA mutations now acquire a database row lock on the account before validating state or changing authenticator secrets, recovery codes or MFA status. PostgreSQL serializes concurrent changes for the same account; SQLite does not implement `FOR UPDATE`.
- Added regression checks for MFA mutation serialization, cross-account isolation coverage, backup/restore safety gates and release configuration.
- Added an operator backup/restore rehearsal runbook with explicit disposable-database safeguards and post-restore verification steps.
- Existing v5.44.0 database schema remains compatible; no new migration is required. Alembic head remains `0045_mfa_and_login_lockout`.

Security review remains a staged engineering activity: these changes are not an independent penetration test or a production security certification.
