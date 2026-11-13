# Product roadmap — Release 2.8

## Implemented foundation
- Authentication, profile, manual intake, RSS/Atom and public JSON opportunity discovery.
- URL fingerprint deduplication, source provenance and freshness tracking.
- Profile-aware deterministic matching and transparent score explanations.
- AI-assisted proposal drafting with safe-template fallback and hash-bound human approval.
- Projects, tasks, milestones, invoices, PDF export and feedback aggregation.
- Client research evidence records and heuristic risk screening.
- Portfolio document chunking, optional embeddings/pgvector and lexical fallback.
- Redis/RQ background jobs.
- Durable LangGraph workflow stages with SQL-backed checkpoints, proposal creation, human approval pause, resume and failed-run retry.

## v1.0 — Explainable opportunity intelligence (implemented)
1. Smart opportunity ranking: 70% profile match, 20% freshness and 10% cautiously smoothed user feedback.
2. Ranking reasons, freshness age, sample counts and ranking version returned by API.
3. Smart ranking and recent-order controls in the Opportunities dashboard.

## v1.1 — Delivery and revenue intelligence (implemented foundation)
1. Deterministic delivery-plan suggestions for kickoff, scope, QA and handover; preview only.
2. Project time/effort tracking with billable value estimates.
3. Invoice due/overdue reminder dashboard and outstanding revenue summary.
4. Proposal win/loss analytics from manually recorded feedback.
5. Reminder display is in-app only; scheduled email/Telegram delivery remains future work.

## v1.2 — Pricing and learning intelligence (implemented foundation)
1. Explainable pricing recommendations using profile rate, estimated effort, minimum budget and comparable recorded wins.
2. Pricing outcome segments by industry, work type and price relative to listing budget.
3. Project profitability view using paid invoices and tracked time-value proxy.
4. Recommendations are advisory only; no automatic proposal price changes or model training.

## v1.3 — Client communication foundation (implemented)
1. Manual client email intake and categorization.
2. Conservative reply drafts, follow-up reminders and human approval.
3. No provider connection or outbound sending in v1.3.

## v1.4 — Gmail and Outlook provider integration (implemented; external setup required)
1. Google and Microsoft authorization-code OAuth with state validation and PKCE S256.
2. Encrypted access/refresh tokens and encrypted short-lived PKCE verifier.
3. Provider identity lookup, access-token refresh and account disconnect.
4. Tenant-scoped inbox sync with provider-message deduplication.
5. Gmail thread-aware send and Outlook create-reply/update/send.
6. Approval digest binds exact subject, body, original recipient and provider.
7. A separate explicit send action is required after approval.
8. Send uncertainty is recorded and never automatically retried.

## v1.5 — Communication intelligence (implemented foundation)
1. Context-aware reply drafts using profile details, explicitly linked project context, recent messages from the same sender, and top portfolio chunks retrieved through the existing lexical/optional-vector retrieval path.
2. Reply prompts explicitly prohibit invented prices, delivery dates, guarantees, achievements and client-specific claims. Every generated draft remains editable and approval-gated; safe template fallback is used when AI generation is unavailable.
3. Client/project matching suggestions use explainable token overlap and are never automatically linked. The user must confirm a project association.
4. Rule-based sentiment and urgency indicators show matched evidence and a disclaimer; they are heuristics, not psychological or definitive sentiment classification.
5. Follow-up cadence recommendations respect the configured profile timezone and are preview-only until the user explicitly creates an in-app reminder.
6. Draft metadata records retrieval sources and generation mode for review.
7. Provider push notifications, scheduled provider sync and incremental sync cursors remain future work.

## Future v1.6 — Official marketplace integrations
- Official APIs and provider-specific compliance only where access and terms permit.
- No browser automation or credential scraping for marketplaces.
- Human approval before every application or external submission.

## Future v1.7 — Delivery and finance automation
- More complete project scope/change tracking, delivery quality and payment reconciliation.
- Optional invoice and reminder delivery after explicit approval.
- No payment movement or tax filing without a separately designed, compliant integration.

## Future v1.8 — Business intelligence
- Forecasting, cohort analytics, client lifetime value and win-rate analysis.
- Calibration based on sufficient user-owned outcome history, with explainability.

## v2.0 — Complete AI Freelance Business Operating System
- Unified discovery, evaluation, proposals, approved outreach, delivery, client relationship management, invoicing and analytics.

## Production hardening
- Email verification, password reset, MFA and session revocation.
- CI for migrations, backend tests, frontend typecheck/build and dependency/security scanning.
- Backup/restore drills, metrics, monitoring, rate limits and privacy controls.
- Security review and tenant-isolation testing before organization support.

## v1.5 boundaries and limitations
- Portfolio retrieval uses the existing per-user portfolio chunks and a bounded candidate set; embeddings are attempted with a short timeout and lexical retrieval remains available.
- LLM output is not guaranteed factual. Context source metadata is provided, and users must verify all claims before approval.
- Project matches are suggestions only; they never mutate the email's project link without explicit confirmation.
- Sentiment and urgency are transparent keyword/rule indicators, not a clinical or reliable assessment of a sender's emotional state.
- Follow-up suggestions do not create reminders unless the user selects the explicit create action.
- The v1.5 feature does not send follow-up emails automatically.

## v1.4 boundaries and limitations
- Provider integrations are optional; manual email intake continues without OAuth credentials.
- Live provider access requires the operator's own Google Cloud / Microsoft Entra app registrations, consent setup, redirect URIs and secrets.
- Gmail sync imports up to 50 inbox messages from the last 30 days per manual sync; Outlook sync imports up to 50 recent inbox messages.
- Provider push notifications, scheduled sync and incremental cursors are future work.
- Google token revocation is attempted on disconnect. Microsoft local credentials are deleted; remove app consent from Microsoft account settings too.
- A send timeout is ambiguous: inspect the provider Sent folder before manual recovery. The application blocks automatic retries to avoid duplicate outreach.
- Marketplace submissions remain disabled. A completed workflow is not a completed external application.


## v1.6 — Marketplace integration foundation (implemented; provider access external)
1. Provider capability catalog and per-user readiness settings.
2. Marketplace application pipeline with opportunity/proposal linkage and deduplication.
3. Proposal-hash-bound explicit approval and audit events.
4. Manual submission recording and application outcome tracking.
5. `/marketplaces` frontend page.
6. No live Upwork/Freelancer/Fiverr/LinkedIn job connector or automated proposal submission is claimed. Official access restrictions are documented.

## v1.7 — Advanced delivery and financial automation (next)
1. Client reply-to-project conversion and milestone extraction with confirmation.
2. Deliverable workspace, versioned handover checklist and client-review gates.
3. Invoice schedules, due-date reminders and cash-flow forecasts.
4. Human approval for every client-facing delivery, invoice and financial action.

## v1.8 — Business intelligence and forecasting
1. Funnel conversion, source ROI and proposal performance dashboards.
2. Capacity, earnings and cash-flow forecasts with confidence ranges.
3. Feedback-informed ranking with explainable sample sizes and safeguards.

## v2.0 — Freelance business operating system
Unify discovery, research, proposal preparation, approved communication, delivery, invoicing, learning and analytics while preserving human control over external actions.


## v1.7 — Advanced delivery and financial automation (implemented foundation)
1. Project deliverables linked to projects and optional tasks.
2. Versioned revision snapshots and content hashes.
3. Exact-version internal review, approval and change-request workflow.
4. Manual client handover and client acceptance/change status tracking.
5. Milestone-linked invoice schedules with hash-bound approval.
6. Explicit invoice-record creation after schedule approval.
7. Deterministic due-date cash-flow outlook and project delivery summary.
8. No automated client delivery, invoice email or payment execution.

## v1.8 — Business intelligence and forecasting (next)
1. Source-to-client-to-proposal conversion funnel and ROI dashboards.
2. Earnings, capacity and cash-flow forecasts with transparent assumptions.
3. Win/loss and client-quality trends, with minimum sample thresholds.
4. Feedback-informed opportunity ranking and explainable recommendations.

## v2.0 — Freelance business operating system
Unify discovery, research, proposals, approved communication, delivery, invoicing, learning and analytics while retaining human approval for external actions.


## v1.8 — Business intelligence and forecasting (implemented foundation)
1. Opportunity-to-proposal-to-application-to-outcome funnel.
2. Source-level opportunity performance and manually recorded win/loss outcomes.
3. Explicit project-to-originating-opportunity attribution for paid invoice revenue.
4. Capacity/utilization from profile weekly-hours target and recorded time.
5. Project profitability with safeguards for missing hourly rates and mixed currencies.
6. Earnings outlook separating paid, overdue, scheduled, invoiced and open proposal values.
7. Historical weighted pipeline estimate only after five decided feedback outcomes.
8. `/analytics` dashboard and API endpoints; no fabricated marketplace events or guaranteed revenue forecasts.

## v2.0 — Freelance Business Operating System (next)
1. Unified workflow dashboard across discovery, proposal, communication, delivery, invoices and learning.
2. AI business coach that explains recommendations from the user's verified records and cites underlying evidence.
3. Personal operating goals, alerts and configurable performance thresholds.
4. End-to-end data quality, tenant isolation, observability, recovery and production deployment hardening.
5. Provider connectors only where official API approval and terms allow; all external submissions and client communications remain explicitly approved by the user.


## v2.1 — Grounded AI Business Coach (implemented foundation)
1. Authenticated coach question and conversation-history endpoints.
2. Account-scoped evidence from profile, goals, opportunities, projects, invoices, tasks, recorded outcomes, recent client emails and portfolio chunks.
3. Bounded retrieval context with source IDs/excerpts and an explicit model-unavailable fallback.
4. `/coach` UI; coach interactions are retained and added to workspace audit history.
5. Advisory-only: no autonomous messages, submissions, delivery, invoice issuance or payments.

## v2.2 — Reliable agent workflows (planned)
1. LangGraph-based multi-step business planning with durable SQL checkpoints and resumability.
2. Typed workflow states, idempotency keys, bounded retries, cancellation and failure recovery.
3. Evidence-aware RAG evaluation, citation validation and retrieval-quality regression tests.
4. Explicit approval checkpoints for every external side effect; approval hashes bind the exact content and target.
5. Operational metrics for latency, token usage, model errors and workflow outcomes without logging secrets or unnecessary client content.

## v2.2 — Evidence-linked Action Planner
- Read-only prioritized next-action queue across invoices, tasks, reminders, opportunities and projects.
- Every recommendation includes source record IDs, rationale and human-approval requirement.
- `/agent` UI and `GET /api/v1/agent/action-plan` endpoint.

## Next: v2.3 — Evaluated RAG and Agent Workflow Reliability
- Retrieval benchmark datasets and regression thresholds for recall@k/MRR.
- Hybrid lexical/vector retrieval with explicit method and source metadata.
- Structured agent outputs, bounded retries, idempotency and persisted run observability.
- Human approval remains a hard gate for all external actions.


## v2.3 — Hybrid RAG and Retrieval Quality (implemented)
- Weighted reciprocal-rank fusion across lexical and vector retrieval.
- MMR diversity-aware candidate ordering.
- Coach query embeddings with lexical fallback and citation-ID validation.
- Offline retrieval metrics: hit rate, precision@K, recall@K, MRR@K and nDCG@K.

## Next: v2.4 — Durable Multi-Agent Business Workflows
- Compose existing specialist agents into bounded LangGraph business workflows.
- Persist run state, node results, retries and resume behavior using the existing workflow tables.
- Add explicit approval checkpoints before any external action.
- Add workflow-level observability for duration, errors and retry counts.


## Release 2.4 completed
- Durable multi-agent business review graph with context, matching, research, delivery, finance and planning stages.
- Per-node SQL checkpoints, resume after failure, bounded retries, per-user idempotency and stale-worker recovery.
- Monitoring UI and evidence-linked recommendations; no external actions.

## Next: 2.5
- Add explicit proposal strategist and client communication planning nodes that reuse existing proposal and email draft services without sending.
- Add per-agent latency/error telemetry and workflow event stream.
- Add retrieval-backed specialist context with citation evaluation.
- Add workflow-level user cancellation and retention controls.
- Add full PostgreSQL/Redis worker integration tests and browser end-to-end tests.


## Release 2.5 — Proposal and Communication Specialist Agents (implemented foundation)
1. Proposal strategist reuses the existing profile-grounded proposal agent for up to three high-match opportunities.
2. Commercial terms are left open unless the user explicitly supplies a proposed price; a client's maximum budget is never treated as the freelancer's quote.
3. Client communication planner reuses existing message urgency, follow-up cadence, project matching and portfolio RAG context services.
4. Recommendations link to saved opportunity, email and portfolio chunk IDs.
5. Per-agent duration telemetry is stored in the workflow trace.
6. Workflow detail returns checkpoint metadata and counts, not full account snapshots.
7. Draft previews and communication plans are not saved or sent; existing approval APIs remain the only route to external actions.

## Next: v2.6 — Agent Operations and Evaluation
- Workflow cancellation and retention controls.
- Structured failure events, per-node retry policy and latency/error dashboards.
- Retrieval citation precision checks for proposal and communication contexts.
- Full integration tests with PostgreSQL, Redis/RQ and multi-process workers.
- Browser end-to-end tests for approval and workflow monitoring.


## v2.6 — Agent operations and evaluation (implemented foundation)
- Workflow cancellation with safe checkpoint fencing.
- Structured operational error labels and per-user workflow metrics.
- Dry-run-first terminal workflow retention cleanup.
- RAG citation quality benchmark harness and live service integration tests remain future work; they are not represented as complete.


## v2.7 — RAG quality and agent reliability (implemented foundation)
- Offline claim/evidence grounding proxy with numeric and negation conflict checks.
- Citation-ID overlap and human-labelled fixture evaluation; current fixture is synthetic only.
- Guarded graph nodes persist stage-specific failure metadata.
- Opt-in PostgreSQL and Redis/RQ service integration checks.
- Full semantic entailment evaluation, a broad human-labelled dataset, live workflow integration and browser E2E remain future work.


## v2.8 — Citation integrity and production validation (implemented foundation)
- Reject unknown evidence IDs in the offline grounding evaluation and report citation integrity independently from lexical claim support.
- Validate benchmark structure, unique IDs, labels and citation references before running scores.
- Require reviewer provenance metadata before a dataset can be labelled human-reviewed; strict CLI mode enforces this.
- CI provisions disposable PostgreSQL/pgvector and Redis services, validates the Alembic migration chain, runs backend tests/integration checks and frontend typecheck/build.
- Semantic entailment judging, a representative human-reviewed dataset and browser approval E2E remain future work.

## Next: v2.9 — Human-reviewed RAG benchmark and approval E2E
- Build a privacy-safe benchmark from consented, redacted examples with independent human labels and adjudication for disagreements.
- Add retrieval recall@k/MRR/nDCG thresholds only after the benchmark has sufficient representative coverage.
- Add browser E2E for proposal edit → approval invalidation → request approval → approve/reject, and workflow pause/resume/cancel.
- Add a staging workflow that verifies tenant isolation, audit events and external-action approval gates without sending real messages or submitting proposals.


## v2.9 — Retrieval quality and approval integrity (implemented foundation)
1. Validated offline retrieval benchmark with hit-rate@k, precision@k, recall@k, MRR@k and nDCG@k.
2. Per-query ranking details and dataset integrity validation.
3. Exact proposal-fingerprint approval policy shared by approval decision, mark-ready and workflow-resume paths.
4. CI executes the retrieval benchmark without paid services or external API calls.
5. Synthetic retrieval data remains a smoke test; representative human-reviewed evaluation is still required.

## Next — Production readiness and user-journey E2E
1. Provisioned CI run of full backend suite, migration chain and Redis/RQ integration.
2. Browser E2E for proposal edit → request approval → reject/approve → mark-ready, including stale-hash and cross-user denial.
3. Real redacted human-reviewed RAG and retrieval benchmarks with agreed release thresholds.
4. Backup/restore drill, dependency/security scanning, rate-limit review and tenant-isolation tests.
5. Operational monitoring and explicit recovery playbooks.


## v3.0 — Production readiness foundation
1. API-level proposal approval journey regression tests: edit, supersede, reject, approve, mark-ready.
2. Tenant isolation regression tests for proposal and approval endpoints.
3. Production startup configuration validation for secrets, PostgreSQL, Redis, HTTPS and CORS.
4. Configuration-only production preflight CLI and CI execution.
5. No schema migration and no automatic external actions.

## Remaining production certification work
1. Run full CI against PostgreSQL/pgvector and Redis/RQ; inspect actual GitHub Actions results.
2. Add browser-based frontend E2E for the critical workflows and authentication flows.
3. Add concurrency/load tests for approvals, retries and idempotency.
4. Run backup/restore drills, dependency vulnerability scans, rate-limit tests and independent security review.
5. Build and label a human-reviewed, consented RAG/retrieval benchmark; do not treat synthetic scores as production quality.
6. Verify actual Render/Vercel deployments and alerting from the deployed commit.


## Release 3.1 follow-up priorities

- Run browser E2E against a staging backend with seeded test accounts and exercise authenticated proposal, approval, workflow, project and invoice journeys.
- Add full tenant-isolation tests for every resource family and concurrency tests against PostgreSQL.
- Add dependency/security scanning and API rate-limit verification in CI.
- Implement dependency-aware readiness checks for PostgreSQL, Redis/RQ and model-provider status; keep `/health` as lightweight liveness.
- Complete a real encrypted backup/restore drill and document recovery-time and recovery-point objectives.
- Establish a human-reviewed, consented retrieval benchmark with documented acceptance thresholds before making accuracy claims.
- Perform a controlled load test and observe latency/error-rate baselines before production scale-up.

These are not represented as complete in 3.1.


## Release 3.2 follow-up priorities

- Resolve every dependency vulnerability reported by the new Python and npm audit jobs, then pin and re-test patched versions.
- Extend tenant-isolation coverage to email OAuth records, email drafts, deliverables, schedules, notifications, workflow checkpoints and document chunks.
- Add authenticated browser flows backed by a seeded staging database for opportunity creation, proposal approval, workflow resume, project delivery and invoice tracking.
- Run the human-reviewed retrieval benchmark on an authorized private dataset and establish pre-registered release thresholds.
- Add distributed rate limiting, per-user quotas and abuse monitoring after choosing a shared backend store and documented policy.
- Run controlled k6 tests against staging and record measured latency/error baselines; do not infer production capacity from the smoke profile.


## Release 3.3 — API protection and readiness (implemented foundation)

1. Redis-backed fixed-window request limits for auth, AI/search and general API route classes.
2. Per-user limits for verified JWT subjects and IP fallback for anonymous requests.
3. Production fail-closed behavior if Redis rate-limit storage is unavailable.
4. Lightweight `/health` liveness and database/Redis-aware `/ready` probe.
5. Validated environment limits and deployment runbook.

## Release 3.4 follow-up priorities

- Add account-level daily/monthly usage quotas for expensive AI tasks, with transparent usage reporting.
- Add abuse signals and alerting for repeated authentication failures, suspicious request bursts and quota exhaustion.
- Add automated Redis outage and recovery tests against a real CI service.
- Complete the remaining tenant-isolation coverage for communication, portfolio, deliverable and workflow data.
- Run the full authenticated staging journey and performance baseline before production scale-up.


## Release 3.4 — AI usage quotas and abuse monitoring (implemented foundation)

- Durable per-user usage events and usage summary endpoint.
- Daily/monthly quota enforcement on proposal generation, email reply drafting and business coach generation.
- PostgreSQL user-row locking serializes quota checks for concurrent requests on the same account.
- Quota exhaustion produces an account-scoped abuse event.
- No fabricated token or monetary cost estimates. Provider token usage, pricing-aware cost reporting, broader endpoint coverage, and a complete operational alerting pipeline remain follow-up work.
- Existing Redis rate limits continue to provide request-burst controls.


## Release 3.5 — usage history and persistent abuse signals (implemented foundation)

- Added bounded, account-scoped recent AI usage history to the usage endpoint.
- Added account-scoped abuse-event summary and recent-event API.
- Persisted authenticated Redis rate-limit violations with per-account/category 60-second Redis deduplication. Anonymous IPs and request payloads are not persisted.
- Added regression tests for usage-history and abuse-summary tenant isolation.
- Remaining: staging-backed workflow coverage across every domain, complete PostgreSQL/pgvector CI, Redis outage/recovery tests, frontend/browser journey, dependency audit, k6 baseline, and backup/restore drill.


## v3.6 — Usage reporting and privacy-conscious operations (implemented foundation)
1. Account-scoped usage reporting grouped by operation and provider, with daily call counts and character totals.
2. Explicitly avoid guessed token counts or monetary costs when providers do not return verifiable usage and pricing.
3. Abuse-event retention utility with dry-run as the default and explicit `--apply` deletion.
4. No migration; existing v3.4/v3.5 usage and abuse tables are reused.
5. Full live PostgreSQL/Redis, browser, security audit and staging verification remain deployment/CI responsibilities.


## v3.7 — Agent workflow quota accounting and tenant regression foundation
1. Agent workflow initiation uses existing per-account AI quota enforcement.
2. Usage event records one initiated workflow operation, not inferred internal model calls/tokens/cost.
3. Idempotent workflow replays do not consume duplicate usage records.
4. Owner-scoped workflow lookup and checkpoint-access regression tests added.
5. Remaining resource-specific tenant API coverage and live staging checks are still planned.


## v3.8 — Tenant-isolation route coverage expansion
1. Two-account API tests for deliverables, time entries, invoice schedules, email intake, follow-up reminders and portfolio documents/search.
2. Existing coverage for core records and agent workflows retained.
3. No migration; tests exercise current owner-scoped routes.
4. OAuth lifecycle, marketplace detail routes, workflow checkpoint variations and PostgreSQL concurrency still need dedicated verification.


## v3.9 — Expanded tenant coverage and RAG usage accounting
1. Added account-boundary API tests for marketplace application records, email provider account metadata, deliverable revision history, invoice schedule approval and workflow checkpoints.
2. Added account quota gating and successful-operation usage events for portfolio embeddings and semantic search.
3. Preserved lexical fallback when embeddings are unavailable or quota-limited.
4. Explicitly scoped deliverable revision aggregation queries by authenticated user.
5. OAuth provider-mocked lifecycle tests, PostgreSQL concurrency, Redis outage/recovery, full staging journey, frontend E2E, security audit, k6 and backup/restore remain planned.


## v4.0.0 — OAuth lifecycle and tenant reliability hardening (implemented)
1. Serialize OAuth state consumption with a database row lock where supported.
2. Convert provider identity lookup transport failures into controlled gateway errors; do not persist an account until identity is verified.
3. Add regression tests for expired state, replay after token-exchange failure, state-to-owner binding, encrypted token persistence and identity-provider outage.
4. Retain manual human approval for marketplace and client-facing actions; no scraping, automatic submission, delivery or payment.
5. CI remains responsible for full PostgreSQL/pgvector + Redis integration, frontend build, browser E2E and dependency audit; local checks are reported separately.


## v4.1.0 — lifecycle integrity and mutation concurrency (implemented; CI verification required)
1. Exercise marketplace draft → hash-bound approval → manually recorded submission → outcome status → audit history.
2. Exercise invoice schedule creation → approval hash validation → explicit approval → one invoice record; prevent issue-before-approval and duplicate issue.
3. Exercise deliverable draft → review request → review hash validation → internal approval → manually recorded handover → client acceptance; preserve delivered/accepted edit lock.
4. Exercise workflow resume only for the owning account and a current proposal approval; assert durable checkpoint creation.
5. Add row-level locks to concurrent marketplace status and deliverable state mutations.
6. Route non-production backend tests to the isolated `TEST_DATABASE_URL` provisioned by CI, while production continues to use `DATABASE_URL` only.
7. Keep provider APIs, email sends, client handover and payment actions out of automated execution.


## v4.2.0 — Redis worker reliability and CI integration (implemented; CI execution required)
1. Exercise Redis connectivity and a real RQ `SimpleWorker` job end-to-end.
2. Exercise authenticated agent-workflow enqueue and idempotent replay against Redis.
3. Simulate queue outage, verify durable failed state, then restore queue access and verify retry enqueue.
4. Wire the existing ephemeral CI Redis service into backend tests as `REDIS_URL` and `TEST_REDIS_URL`.
5. Correct frontend package metadata JSON so npm install/build/audit can parse it.
6. Do not claim Redis integration, frontend build or dependency audit passed until the full CI workflow executes.


## v4.3.0 — authenticated journey and recovery verification (implemented; CI/staging execution required)
1. Add a deterministic authenticated journey regression spanning opportunity discovery, proposal generation, explicit approval, project creation, deliverable review/handover recording and unpaid invoice creation.
2. Stub AI proposal generation in the test so the journey does not require Ollama, OpenAI or any external provider.
3. Add checksum/archive validation and guarded disposable-database restore tooling for PostgreSQL backups.
4. Add a manually triggered k6 smoke workflow that only accepts HTTPS staging hosts and requires explicit confirmation.
5. Store k6 summaries as short-lived workflow artifacts; do not publish fabricated latency or throughput claims.
6. Continue to require full CI, staging results, security audit and a real restore drill before production-readiness claims.


## v4.4.0 — worker reliability and audit evidence (implemented; CI required)
1. Verify queued cancellation is respected when a worker eventually picks up the job.
2. Verify a superseded worker attempt cannot append a durable checkpoint.
3. Retain machine-readable Python and npm dependency audit reports in CI.
4. Pin Playwright test dependency to an exact version.
5. Keep full CI, staging performance, backup restore and human-reviewed RAG evaluation as explicit release gates.


## v4.5.0 — deployment configuration and go-live hardening (implemented; provider deployment pending)
1. Separate Docker Compose migrations from API/worker process startup.
2. Add service readiness and worker Redis startup checks.
3. Validate cloud AI provider endpoints and production frontend API origin.
4. Add a complete Vercel + Render deployment guide and guarded deployment preflight.
5. Keep full CI, actual provider deployment, restore drill, staging performance and RAG human evaluation as release gates.


## v4.6.0 — Release packaging and recovery safety
- Reproducible, secret-safe source ZIP packaging with per-file SHA-256 manifests and archive verification.
- Regression tests for package exclusions and semantic version validation.
- Backup archive validation before checksum publication and collision protection.
- Restore checksum/archive validation, explicit destructive confirmation, and transactional restore.
- No schema changes; no new production runtime dependencies.

## Next priorities
- Execute full CI against real PostgreSQL/pgvector and Redis services and retain run evidence.
- Complete frontend browser tests and dependency audits in network-enabled CI.
- Perform a disposable-database backup/restore drill and record post-restore application checks.
- Run staging load tests and a human-reviewed RAG/retrieval benchmark.
- Implement marketplace connectors only against official, authorized APIs with provider-specific OAuth and terms review.
- Keep proposal submission, external messaging, client handover and financial actions explicitly human-approved.


## v4.7.0 — Complete action planning across the freelance lifecycle
- Expanded the account-scoped action planner to include milestones, deliverable reviews, invoice schedules, proposal approvals, email draft approvals and approved marketplace applications awaiting manual submission.
- Added priority-aware action ranking and category counts/filtering in the Action Planner UI.
- Preserved evidence links, account scoping and explicit human approval boundaries.
- No database schema migration or new runtime dependency.


## v4.8.0 — Client CRM and scope-change control
- Account-owned client records with contact details, tags, notes and status.
- Project-to-client linking with legacy `client_name` compatibility.
- Client activity history from linked project, email, invoice and scope-change records.
- Scope-change request lifecycle with immutable approval fingerprint, budget/timeline delta validation and explicit client-acceptance attestation.
- Approved scope changes update the project baseline and create workspace audit events.
- Pending scope changes are included in the AI Action Planner.

## v4.9.0 client operations
- Client contract/SOW draft records with content fingerprints and guarded manual lifecycle transitions.
- Manual client communication timeline.
- Client-level revenue and recorded-time-cost estimate, with currency separation and explicit exclusions.
- Future work: signed-document storage/verification, immutable contract revision history, automated but human-approved communication connectors, payment reconciliation from verified provider records, and richer client health indicators.

## v5.0.0 — immutable contract and delivery history
- Store each client contract/SOW version as an immutable snapshot with a SHA-256 content fingerprint and parent-hash link.
- Require revised documents to return to draft and obtain fresh manual send/acceptance recording; do not overwrite accepted/archived/expired records.
- Verify contract revision sequence and content fingerprints when history is requested.
- Record each deliverable client acceptance/change request against the exact deliverable revision and content fingerprint.
- Backfill available historical client decisions without inventing missing evidence or reconstructing revisions that were never stored.
- Preserve account isolation and human attestation boundaries; no e-signature, auto-send or client identity verification is claimed.

## v5.1.0 — payment evidence reconciliation
- Append-only manual invoice receipt, refund and dispute event ledger.
- Partial payment, net receipt and outstanding balance calculations.
- Currency-isolated reconciliation and refund/dispute lifecycle safeguards.
- These are manual evidence records, not bank-verified events or a payment gateway. Official provider connectors remain future work.

## v5.2.0 — client profitability and business intelligence
- Manual direct client/project cost records with supporting evidence references.
- Client profitability by currency: invoiced, net received, outstanding, labor-cost proxy, direct costs and estimated cash contribution.
- Transparent relationship-health heuristic using overdue balances, payment delay on fully settled invoices, recorded communication recency and client status.
- Client Insights page and cost history in the client activity timeline.
- Future work: verified provider reconciliation, bank/accounting integrations, audited cost imports, richer forecast calibration and human-reviewed AI insights.


## v5.3.0 — Opportunity Intelligence
- Re-score saved opportunities against the user's current profile rather than relying only on scores stored at ingestion time.
- Explain skill overlap, missing skills, profile dealbreakers, preference warnings, ranking freshness and historical outcome influence.
- Persist a user-owned shortlist decision, notes and next-action date.
- Add an Opportunity Intelligence workspace for ranking, review, risk-screening and draft proposal preparation.
- Preserve source provenance and duplicate-source context.
- Marketplace access modes remain readiness metadata. No provider-specific official API client or automatic application submission is claimed.

## v5.4.0 — marketplace integration readiness hardening
- Add fail-closed adapter contracts for Upwork and Freelancer.com; neither is represented as a live connector until credentials and provider-specific endpoint behavior are verified.
- Add account-scoped provider readiness endpoint with explicit `live_api_verified=false` and `submission_enabled=false`.
- Reject settings that attempt to label a marketplace API as configured without a verified connection; legacy configured labels are surfaced as not verified.
- Keep discovery on permitted RSS/Atom, public JSON and manual imports; no scraping or browser automation.
- Keep marketplace submission disabled and human-controlled.
- Future work: implement a provider-specific read-only adapter after API credentials, eligibility, scopes and terms are verified; then add encrypted token storage, refresh, revocation, rate limits, idempotent imports and provider-backed tests.


## v5.5.0 — secure marketplace credential vault foundation
- Add encrypted per-user token storage using the existing Fernet encryption key.
- Add non-secret credential status and account-owner local credential deletion.
- Keep token ingestion internal to a future validated OAuth callback; no public raw-token endpoint.
- Keep provider live verification and application submission disabled until official OAuth/API behavior is implemented and tested.
- Next: implement one provider's official OAuth flow only after the account has valid developer access, approved scopes, redirect configuration and verified current documentation.


## v5.6.0 — Upwork OAuth authorization foundation

- Add official Upwork authorization-code OAuth with PKCE and one-time state.
- Encrypt access/refresh tokens using the existing per-deployment Fernet key.
- Add manual token refresh and metadata-only status.
- Keep account identity, GraphQL discovery, and application submission unverified/disabled pending live API scope testing.
- Leave Freelancer OAuth unimplemented until its precise official auth contract and approved credentials are verified.


## v5.7.0 — Upwork read-only GraphQL discovery
- Implement the official `marketplaceJobPostingsSearch` GraphQL query with approved marketplace-read permissions.
- Reuse encrypted per-user OAuth credentials and refresh expired access tokens through the existing refresh flow.
- Use the authenticated user's default Upwork organization context; user-specific organization selection can be added if supported use cases require it.
- Normalize supported listing fields, import into the existing opportunity pipeline, profile-score and deduplicate.
- Add cursor-based pagination, bounded rate-limit retry, safe error mapping and account-level API verification.
- Redact provider listing cache after 22 hours and require an hourly retention task before enabling discovery.
- Keep the connector read-only; no automatic proposal submission or provider mutations.
- Future work: verify live Upwork API access and account-specific scopes; add scheduled refresh only after rate-limit and terms review; implement Freelancer only after its app-specific authorization contract and approved credentials are tested.


## v5.8.0 — Saved searches and scheduled read-only discovery

- Add user-owned saved Upwork search configurations with 6/12/24-hour intervals, bounded page size, pause/resume and deletion.
- Add a 15-minute scheduler that claims due searches, runs the existing official read-only GraphQL client, and reuses current opportunity scoring and deduplication.
- Keep listing-content retention cleanup as a separate hourly job; discovery must remain disabled until both jobs are deployed and verified.
- Record last run, next run, result count and bounded error status per saved search.
- No automatic proposal submission or marketplace mutation.
- Future work: strengthen client quality signals and freshness ranking using provider-supported evidence; verify Freelancer app-specific OAuth and endpoints before implementation.


## v5.9.0 — Risk-aware opportunity intelligence (implemented)
1. Add listing-level risk signals to each opportunity intelligence record.
2. Add evidence-confidence-weighted risk quality to ranking without treating missing evidence as proof of safety.
3. Preserve the existing deterministic profile score, freshness signal and conservative historical-feedback prior.
4. Return risk level, score, evidence coverage, signals, questions to ask and limitations.
5. No migration; external submission remains disabled and human approval remains mandatory.

## Next planned work
1. Improve client-quality evidence using only provider-supported fields and provenance; never infer payment history or reputation from absent fields.
2. Add profile-aware saved-search filters only after confirming the current Upwork GraphQL schema supports each filter.
3. Add portfolio-RAG evidence links to proposal drafts and an explicit factual-claim validation step.
4. Add discovery and proposal analytics with clear denominators and minimum sample sizes.
5. Implement Freelancer only after approved API access, current official auth documentation and mocked/live contract tests are available.


## v5.10.0 — Portfolio-grounded proposal intelligence (implemented foundation)
1. Build a bounded opportunity-specific retrieval query from title, description, required skills and industry.
2. Retrieve only the authenticated user's existing portfolio chunks using hybrid retrieval when embeddings are available and lexical fallback otherwise.
3. Add an inspection endpoint exposing source document/chunk IDs, retrieval mode, similarity, evidence coverage and limitations before proposal generation.
4. Ground proposal prompts in retrieved evidence and prohibit unsupported project, client, metric, certification and outcome claims.
5. Return grounding provenance with newly generated proposal responses; preserve the existing proposal model and approval-hash behavior without a database migration.
6. No automatic outreach, marketplace submission, client communication or delivery.

## Next planned work
1. Add structured factual-claim extraction and deterministic source-span validation for generated proposals.
2. Add proposal quality evaluation fixtures covering unsupported claims, prompt injection in job descriptions, pricing integrity and missing portfolio evidence.
3. Add proposal performance analytics segmented by evidence coverage and manually recorded outcomes, with minimum sample safeguards.
4. Continue client-quality evidence improvements using only verified provider-supported data.
5. Continue saved-search filter improvements only when official marketplace schemas support the fields.

## v5.11.0 — Proposal factual-claim review (implemented foundation)
1. Add deterministic review flags for experience-duration, quantified-outcome, credential, named-client/employer and specific-delivery claims in proposal drafts.
2. Compare flagged phrases against retrieved portfolio excerpts and report lexical overlap as a review hint only; never treat overlap as proof.
3. Return claim-review status, findings and limitations alongside the existing portfolio grounding metadata.
4. Show flagged claims in the opportunity-intelligence UI so the user can verify or remove them before approval.
5. No database migration, schema change, new environment variable or external side effect.
6. Human review remains mandatory; heuristic detection can both miss claims and produce false positives.

## Next: v5.12.0 — Proposal evaluation and outcome intelligence
1. Add regression fixtures for prompt injection, unsupported experience, numeric metrics, credentials, named clients, pricing integrity and empty evidence.
2. Add deterministic proposal-quality rubric (scope coverage, approach, deliverables, assumptions, questions, unsupported commitments) with explanations, not opaque quality scores.
3. Segment manually recorded win/loss outcomes by evidence coverage and source with minimum sample sizes and explicit denominators.
4. Keep all analytics descriptive until enough user-owned outcomes exist; do not auto-submit or auto-optimize pricing.


## v5.12 — Proposal quality and commercial-integrity review (implemented)
1. Deterministic completeness rubric with transparent per-check results.
2. Detects instruction-like text in untrusted opportunity descriptions and flags instruction echoes in generated drafts.
3. Flags a structured quote above the listing's stated maximum budget and monetary amounts in drafts when no structured quote was supplied.
4. Adds additive `quality_review` response metadata and frontend review display.
5. No automatic editing, approval, submission, outreach or currency conversion; budget comparisons require same-currency interpretation by the user.

## Next: v5.13 — Proposal evaluation and outcome learning
- Build human-labelled proposal-quality fixtures and a repeatable evaluation command.
- Evaluate claim-review false positives/negatives, evidence citation correctness and injection resistance.
- Add proposal outcome analytics segmented by evidence coverage only after minimum sample thresholds.
- Preserve tenant isolation, source provenance and explicit human approval for all external actions.


## v5.13.0 — Proposal evaluation harness (implemented foundation)
1. Synthetic, versioned regression fixtures for proposal quality and commercial-integrity checks.
2. Offline evaluator reports per-case outcomes, flag precision and recall.
3. Dataset validation rejects empty sets and duplicate IDs.
4. No user/client data is included; fixtures are explicitly synthetic and not human-reviewed.
5. Semantic factual truth, broad human-reviewed benchmark coverage, live provider outcome attribution and automated learning remain future work.

## Next: v5.14.0 — Evidence-backed outcome learning
- Link manually recorded proposal outcomes to evidence coverage and quality-review signals without claiming causation.
- Require minimum sample sizes before showing segment comparisons.
- Separate unknown/no-response outcomes from explicit wins and losses.
- Provide transparent sample sizes, confidence caveats and privacy-safe aggregation.


## v5.14.0 — Evidence-aware proposal outcome intelligence (implemented foundation)
1. Latest proposal and latest manually recorded feedback are joined once per opportunity.
2. Source-level outcomes separate wins, losses, unknown/no-response and undecided.
3. Proposal drafts are grouped by deterministic basic-check bands for exploratory comparison.
4. Configurable minimum decided sample (default 5) gates win-rate display; descriptive rates remain separately labelled.
5. Analytics UI and authenticated API endpoint added without schema migration.
6. No causal claim, automatic learning, inferred marketplace outcome or external action is introduced.

## Next: v5.15.0 — Client and source ROI decision support
- Add currency-safe revenue attribution and explicit cost capture before calculating ROI.
- Separate opportunity volume, recorded submissions, wins and paid revenue in source comparisons.
- Add recency windows and minimum-sample warnings.
- Include explainable recommendations and avoid ranking sources when data coverage is insufficient.


## v5.15.0 — Source ROI and acquisition decision support (implemented foundation)
1. Source funnel separates opportunities, application records, recorded submissions, wins, losses and unknown outcomes.
2. Source win rates require a configurable minimum decided sample (default 5).
3. Paid revenue is attributed only through explicit project → originating opportunity links.
4. Manual project costs are attributed only through explicit cost → project → originating opportunity links.
5. Revenue and cost comparisons are currency-safe; ROI is withheld unless both paid revenue and cost exist in the same currency.
6. Client-level/unlinked overhead and unlinked project data are excluded rather than guessed.
7. Analytics dashboard surfaces the cost and ROI breakdown with limitations.

## Next: v5.16.0 — Time-windowed acquisition intelligence
- Compare source performance across explicit 30/90/180-day windows.
- Add time-windowed lead-to-proposal-to-recorded-submission funnel metrics.
- Show data coverage and sample sufficiency before source recommendations.
- Add user-entered source-specific acquisition costs only with explicit currency and date attribution.
- Keep recommendations advisory; no automated marketplace actions.


## v1.8.1 — Time-windowed source intelligence (implemented in v5.16.0)
1. Rolling 30/90/180-day source activity views for newly added opportunities, proposals created, submitted applications and manually recorded outcomes.
2. Recorded receipts/refunds attributed only through invoice → project → originating opportunity, with currency separation.
3. Each stage is dated independently; this is a period-activity view, not a cohort conversion model. Missing timestamps and unlinked records are excluded.
4. Next: cohort-based attribution with immutable lifecycle event history, once event capture is complete enough to avoid backfilled or inferred timestamps.


## v5.19.0 — Opportunity cohort conversion intelligence (implemented)
1. Cohort membership is based on opportunity discovery date, then follows the same opportunity through proposal creation, recorded marketplace submission, latest decided feedback, project creation and manually recorded net cash.
2. Conversion percentages use distinct opportunity counts rather than mixing independent event totals.
3. Cash is attributed only through invoice → project → originating opportunity, with refunds netted and currencies kept separate.
4. Cohort age and data limitations are exposed so recent cohorts are not mistaken for mature conversion results.
5. No database migration, new dependency, auto-apply or external communication.
\n\n## v5.19.0 — Freelance Growth Intelligence\n- Explainable source-growth actions gated by cohort sample sizes.\n- Next: add service-category profitability and time-to-conversion diagnostics with strict data coverage labels.\n

## v5.19.0 — Service Category Intelligence
- Compare service categories using recorded conversion, milestone speed and partial project economics.
- Next: improve portfolio/service offer linkage and evidence-backed recommendation quality without automatic outreach.


## v5.20.0 — Portfolio-to-Service Matching and Opportunity Quality Intelligence (implemented)
1. Add deterministic skill overlap between structured opportunity requirements and the user's own profile skills/headline/bio.
2. Match indexed portfolio chunks against each opportunity and expose source-document names, excerpts and relevance.
3. Separate profile skill coverage from portfolio proof; missing profile/portfolio data is marked unknown and fit scores are withheld or weight-renormalized.
4. Return potential gaps and explicit reasons so the user can decide whether to improve skills, portfolio evidence or reject the opportunity.
5. Add listing completeness indicators for scope, budget, client identity and deadline, with coverage labels; these are not client trust or payment guarantees.
6. Keep the endpoint authenticated, read-only and tenant-scoped. No schema migration, new dependency or external action.

## Next: v5.21.0 — Capacity-aware pursuit planning
- Compare estimated opportunity hours with the user's weekly capacity and currently active project workload.
- Distinguish deadline feasibility from skill fit and show unknown when hours/deadlines are absent.
- Add an explainable pursuit recommendation that combines fit, client risk, listing quality and capacity without allowing one missing field to create a false negative.
- Keep all proposal submission, client messaging and contract decisions behind explicit human approval.

## v5.21.0 — Capacity-aware pursuit planning (implemented)
- Compare estimated opportunity effort and deadline with profile weekly capacity and observed workload from active-project time entries.
- Surface active projects without recent time logs; unknown workload is never silently treated as zero.
- Missing opportunity effort or deadline produces an unknown feasibility state.
- Read-only authenticated analytics endpoint and Business Intelligence UI; no automatic application or external action.

## v5.23.0 — Workload commitments and delivery planning (implemented)

- Add optional task estimated-hours and planned-start fields, retaining existing due dates.
- Allocate open task estimates across weekly windows and flag overload against profile capacity.
- Report unscheduled, unestimated and overdue tasks separately; never treat missing estimates as zero.
- Expose authenticated user-scoped analytics and Delivery task-entry controls.
- Keep allocations advisory; no automatic rescheduling or client delivery.

## v5.24.0 — Dependency-aware delivery planning (implemented)
- Add explicit user-entered finish-to-start task dependencies within a project.
- Reject self-dependencies, duplicate edges, cross-project links and circular sequences.
- Calculate an explainable longest dependency chain from known task-hour estimates; missing effort stays explicitly unknown.
- Surface dependency date conflicts as review prompts; no automatic date changes or client communication.

## Next: v5.25.0 — Delivery schedule recommendations (draft-only)
- Combine dependencies, calendar availability, task estimates and weekly capacity.
- Generate alternative task ordering and date proposals with assumptions and confidence.
- Show trade-offs and milestone impact; never change dates without explicit user confirmation.
- Add schedule versioning/audit trail so accepted changes can be reviewed and reverted.


## v5.25.0 — Capacity-aware delivery schedule recommendations (implemented)
- Combine estimated effort, finish-to-start dependencies, weekday capacity and user-entered calendar blocks to propose task start/finish dates.
- Block successor scheduling when predecessor effort is unknown or its schedule cannot be calculated.
- Report projected late tasks and project-level milestone risks without pretending milestone-to-task links exist.
- Expose an authenticated, read-only analytics endpoint and dashboard table; no task dates or client commitments are changed.

## Next: v5.26.0 — Schedule review, approval and audit trail
- Allow users to select proposed date changes and review the complete before/after diff.
- Require explicit confirmation before updating task dates.
- Record who approved a schedule change, timestamp, reason and prior values.
- Provide rollback of an approved change set; never notify clients automatically.


## v5.26.0 — Schedule approval, versioning and audit trail (implemented)

- Save recommendation snapshots as versioned drafts; list recent versions.
- Approve/reject drafts with reason and timestamp.
- Fingerprint source inputs and reject stale approvals.
- Apply only planned start/finish dates; preserve contractual due dates.
- Roll back only when task dates have not subsequently changed.
- Next: v5.27.0 — workload-aware task execution tracking and actual-vs-planned schedule variance.

## v5.27.0 — Actual-versus-planned delivery intelligence (implemented)

- Added task completion timestamps, recorded when a task transitions to `done` and cleared if it is reopened; existing completed tasks retain unknown completion dates rather than receiving fabricated historical timestamps.
- Added `GET /api/v1/analytics/delivery-performance`, comparing task estimates with task-linked time entries and planned finish dates with explicitly recorded completion timestamps.
- Reports per-task effort variance, per-project descriptive summaries, missing estimates/time logs, and median absolute effort error. Small samples are labelled; missing actuals remain unknown.
- Added Business Intelligence tables for project-level and task-level delivery performance.
- Added migration `0034_task_completion_tracking`; no new runtime dependencies.
- Fixed schedule-plan approval fingerprint validation to load the user's milestone records before comparing the current inputs.
- External actions, client communication and automatic schedule changes remain disabled; this release only records completion and reports delivery intelligence.

### v5.28.0 direction

- Use only sufficiently large, comparable completed-task samples to suggest effort-estimate adjustments.
- Show calibrated estimate ranges with sample size and confidence; never silently overwrite user estimates.
- Add task-level delivery bottleneck and rework signals only where explicit records support them.


## v5.28.0 — Adaptive effort estimation (implemented)

- Learn descriptive effort ranges from similar completed, time-tracked tasks.
- Report median recommendation, 25th–75th percentile range, matched sample count, dispersion and confidence.
- Keep recommendations read-only and withhold estimates when similar history is insufficient.
- Next: v5.29.0 — delivery bottleneck and rework intelligence, only where task/dependency and revision records support the analysis.


## v5.29.0 — Delivery bottleneck and revision intelligence (implemented)

- Added dependency-aware task review signals using critical-path membership, successor fan-out and recorded overdue dates. Signals are review priorities, not causal claims or probabilities.
- Added deliverable revision-activity summaries from immutable revision snapshots; additional versions after the initial snapshot are counted separately.
- Added user-scoped analytics endpoint and Business Intelligence views. No migrations or new runtime dependencies.
- Cleanup removes only generated caches/bytecode; historical source, tests and release documentation remain.



## v5.31.0 — Explicit deliverable revision-origin classification (implemented)

- Added revision-origin metadata: client-requested, internal improvement, approved scope change, other, and unclassified. Initial snapshots are marked initial.
- Added evidence/note fields for client-requested and approved-scope-change revisions; these classifications require a meaningful explanation and evidence reference at save time.
- Historical revisions migrate to unclassified (except the initial version); no retrospective classification is inferred from timing, acceptance events or free-text notes.
- Updated delivery workspace controls and delivery-quality analytics to show explicit origin counts.
- Added migration `0035_deliverable_revision_origin`; no new runtime dependencies. External client communication and contractual actions remain manual and approval-gated.

### Next: v5.32.0 — Delivery evidence and client approval traceability
- Add immutable references linking a revision to the exact client feedback event or approved scope-change record when the user selects one.
- Verify referenced records belong to the same user, project and deliverable before saving the link.
- Surface evidence completeness separately from user-entered origin labels; do not call labels verified client truth.
- Preserve revision snapshots and prevent editing/deleting historical evidence links through ordinary update endpoints.


## v5.32.0 — Delivery evidence and client approval traceability (implemented)

- Revision snapshots can link to one exact client changes-requested event or one exact client-accepted approved scope-change record.
- Client-feedback links are validated against the same user, deliverable, current revision number, decision type and content hash. Scope-change links are validated against the same user and project and must be explicitly approved and client-accepted.
- Revision evidence links are append-only with the revision snapshot; foreign keys use RESTRICT so linked source evidence cannot be deleted while referenced.
- Revision history exposes linked record IDs and evidence-link status. The Delivery workspace accepts the relevant record ID and displays client-feedback event IDs for selection.
- Historical revisions receive no inferred links; evidence completeness remains distinct from origin labels. No external communication is sent.

## v5.33.0 — Delivery audit integrity and revision evidence coverage (implemented)
- Added per-project SHA-256 hash chaining for delivery audit events, including deterministic backfill of existing events and a persisted project head hash in migration `0037_delivery_audit_hash_chain`.
- Routed all delivery and invoice-schedule audit event creation through a project-serialized append helper.
- Added authenticated integrity verification and revision-evidence coverage endpoints, with per-project dashboard reporting.
- Coverage denominator includes only explicitly classified client-requested and approved-scope-change revisions; unclassified origins remain unknown.
- Hash chains and persisted project heads detect partial tampering and tail truncation but are not a digital signature or protection against full-database rewrite by a privileged actor.

### Next: v5.34.0 — Delivery dispute and corrective-action workflow
- Add human-managed issue/dispute records linked to exact deliverable revisions and client feedback.
- Record severity, owner, corrective action, due date, resolution evidence and explicit closure.
- Keep external client communication and contractual changes approval-gated and manual.


## v5.34.0 — Delivery Dispute and Corrective-Action Workflow (implemented)
- Account-scoped issue records bind to an exact deliverable revision; optional client feedback links must match the same deliverable, revision version, content hash, and `changes_requested` decision.
- Severity, assignment, due date, corrective action, resolution note and resolution evidence are tracked independently.
- Deterministic transitions: open/triaged → in progress → resolved → closed; resolved issues may return to in progress; closed issues are terminal.
- Resolution requires corrective action, a resolution note and evidence reference.
- Issue creation and updates append to the project's existing tamper-evident delivery audit chain.
- Human-only workflow; no external client communication or contractual side effect.

## Next: v5.35.0 — Delivery Dispute Analytics and SLA Review
- Summarize issue volume and severity by project/service, while preserving small-sample caveats.
- Surface overdue open issues and time-to-triage/resolution only when timestamps support it.
- Add root-cause categories as explicit user-entered labels, never inferred as fact.
- Add evidence coverage and unresolved-risk dashboard views; no automatic client communication.


## v5.35.0 — Delivery Dispute Analytics and SLA Review (implemented)
- Added explicit root-cause taxonomy: scope mismatch, unclear requirements, communication gap, quality defect, dependency delay, client input delay, capacity/estimation, technical risk, other and unclassified. No cause is inferred from narrative text.
- Added user-scoped project and overall analytics for issue volume, severity, status, root-cause counts, unresolved and overdue issues.
- Added median triage and resolution durations only when the required timestamps are present; missing evidence remains unknown.
- Added dashboard reporting and migration `0039_delivery_issue_root_cause`. Operational due-date review is not a contractual SLA promise.

### Next: v5.36.0 — Client-facing delivery health and change-control readiness
- Add an internal, read-only project delivery health scorecard based on verified task, acceptance, dispute, audit-integrity and evidence-coverage records.
- Separate verified facts, user-entered labels and missing data; avoid opaque AI scores or unsupported client-risk claims.
- Add approval-ready change-control summaries; never send messages or alter contracts automatically.


## v5.36.0 — Client-facing delivery health and change-control readiness (implemented)
- Added internal, read-only project delivery health scorecards using deterministic, documented rules across task dates, acceptance decisions, delivery disputes, audit-chain verification and revision-evidence coverage.
- Separates recorded facts, user-entered issue labels, review warnings and missing data. Missing records are not treated as positive evidence; insufficient data prevents an `on_track` conclusion.
- Added approval-ready scope-change summaries with required-field completeness, recorded budget/timeline impact, status and client-acceptance fields. Summaries remain drafts for human review; no approval, contract amendment or external message is performed.
- Added `GET /api/v1/analytics/delivery-health` and Business Intelligence project scorecard. No schema migration or new runtime dependency.

### Next: v5.37.0 — Delivery readiness snapshots and controlled client handover packs
- Add versioned, immutable internal snapshots of project health, accepted deliverables, open issues, evidence references and approved scope changes.
- Generate a previewable handover pack from recorded facts only, with explicit unknowns and source IDs.
- Fingerprint snapshot inputs and flag stale previews after underlying records change.
- Require explicit human approval before export or external sharing; no automatic client delivery.


## v5.37.0 — Versioned delivery readiness snapshots and controlled handover packs
- Immutable project handover snapshot payloads with per-project version numbers.
- Snapshot fingerprints bind the preview to current project, deliverable, revision, feedback, issue, scope-change and audit-integrity inputs.
- Explicit approval rejects stale snapshots; only approved snapshots can be exported.
- Local JSON export only; no client communication or external sharing.
- Missing feedback remains unknown and never implies client acceptance.
- No historical project data is rewritten. Migration `0040_delivery_handover_snapshots`.


## v5.38.0 — PDF handover and closeout readiness (implemented)
- Added printable PDF rendering for approved, hash-verified handover snapshots only.
- Added invoice/payment reconciliation to snapshot content without combining currencies.
- Added deterministic closeout readiness endpoint and dashboard blockers. Acceptance must match the latest revision's version and content hash; payment totals are manual ledger facts only.
- No migration or new runtime dependency; existing ReportLab dependency reused.

### Next: v5.39.0 — Closeout sign-off and retention controls
- Add versioned, human-entered closeout sign-off with explicit role/actor, timestamp, evidence and snapshot hash.
- Revalidate closeout readiness and snapshot freshness at sign-off.
- Add configurable export retention and redaction preview; never silently alter immutable snapshots.
- Keep final project closure and client communication manual and explicitly confirmed.


## v5.39.0 — Closeout sign-off and retention controls (implemented)
- Append-only human sign-offs tied to an approved snapshot hash and live closeout fingerprint.
- Revalidation before sign-off and again before explicit project closure.
- Separate immutable project closure record and explicit confirmation phrase.
- Non-destructive retention and redaction previews.

### Next: v5.40.0 — Post-closeout archive and project outcome review
- Immutable archive manifest covering handover, sign-off, closure and evidence hashes.
- Project outcome summary: planned vs actual dates, recorded revenue/cost, delivery quality and dispute history.
- Archive integrity verification endpoint and downloadable archive manifest.
- Retention policy configuration with review/approval workflow; no automatic deletion by default.


## v5.40.0 — Post-closeout archive and project outcome review (implemented)
- Immutable archive manifest versions after explicit closure.
- Manifest hashes, component hashes and source-reference verification for snapshot, sign-off and closure.
- JSON manifest download with verification gate.
- Project outcome summary across schedule, recorded cash/cost, billable time, acceptance coverage and disputes.
- Retention policy change request/decision workflow. Retention controls review timing only and never automatically delete records.
- Migration `0042_post_closeout_archive_and_retention`.

### Next: v5.41.0 — Archive lifecycle and recovery readiness
- Add archive export bundles with a deterministic manifest plus approved handover PDF and JSON.
- Add archive verification report with per-component and per-evidence-reference outcomes.
- Add explicit archive supersession records rather than modifying old manifests.
- Add restore/recovery rehearsal checklist and export checksums.
- Preserve retention as a human-reviewed schedule; no silent purge.


## v5.41.0 — Archive lifecycle and recovery readiness (implemented)
- Reproducible ZIP archive bundle with manifest, approved handover snapshot JSON/PDF, verification report, README and SHA-256SUMS.
- Detailed per-component and per-evidence-reference integrity report.
- Append-only archive supersession records; original archive manifests remain immutable.
- Human-run recovery rehearsal checklist with required evidence references and recorded operator/time.
- Recovery checklist is a record of operator assertions, not an automated restore or external-file verification.
- Migration `0043_archive_bundle_and_supersession`.

## Release status after v5.41.0
No further feature release is scheduled until the v5.41.0 deployment gates are completed on a real staging environment. See `docs/RELEASE_READINESS_GAPS_5.41.md` and `docs/FINAL_DEPLOYMENT_GUIDE_5.41.md`. The next work should be driven by verified staging failures and actual user requirements, not by adding features before the current system is deployed and validated.


## v5.42.0 — Production launch stabilization (implemented)
- Worker heartbeat with a 90-second Redis TTL, unique per worker process and safe for multiple worker instances.
- Secret-key-protected `/api/v1/system/diagnostics` endpoint with database, migration, Redis, queue, worker and AI provider configuration status.
- Diagnostics redact provider credentials and URLs; OpenAI-compatible providers are configuration-checked but not pinged to avoid billable requests.
- Production `/ready` now checks PostgreSQL connectivity, Redis connectivity, expected Alembic head and production configuration.
- Closed account registration by default in application settings; explicitly enable only for first account onboarding, then disable it.
- Production config rejects low-diversity secrets and validates the optional diagnostics key.
- No database migration added; existing head remains `0043_archive_bundle_and_supersession`.

## Remaining launch blockers (not represented as completed)
- Full backend and frontend CI must pass in a dependency-complete CI runner.
- Email verification, password reset, MFA and session revocation remain unimplemented.
- Full production tenant-isolation/security review and independent penetration test remain required.
- Real provider API credentials, rate limits, marketplace approvals and live OAuth callbacks must be verified in staging.
- A real database backup/restore drill and worker job execution test remain deployment gates.


## v5.43.0 — Account security and production authentication (implemented in source)
- Email verification and resend flow with 24-hour single-use token.
- Password reset flow with 30-minute single-use token and generic responses.
- Password change, logout, logout-all, list sessions and revoke individual session.
- Database-backed JWT session IDs; revoked/expired sessions are rejected by authentication dependency.
- SHA-256 digests stored for one-time email action tokens; password hashes use bcrypt_sha256 with legacy bcrypt verification.
- SMTP transport with STARTTLS or implicit TLS; production config requires verification, SMTP sender and HTTPS app URL.
- Frontend account recovery controls and `/security` session management.
- Migration `0044_account_security`.

## v5.43 release gates still to complete
- Run complete backend and frontend CI in dependency-complete CI.
- Test SMTP delivery, verification, password reset, session revocation and concurrent token replay against staging PostgreSQL.
- Complete independent security review, MFA and account recovery abuse review.
- Confirm email provider domain authentication (SPF/DKIM/DMARC) and delivery reputation.


## v5.44.0 — MFA and login abuse protection (implemented in source)
- TOTP setup, enable, login verification and disable flows.
- Encrypted TOTP secrets, one-time recovery codes stored only as hashes.
- Single-use database-backed login challenges with attempt limit.
- TOTP time-step replay prevention.
- Configurable failed-login threshold and timed account lockout.
- Frontend authenticator challenge and account security setup UI.
- Migration `0045_mfa_and_login_lockout`.

## v5.44 remaining release gates
- Run migration on disposable PostgreSQL and verify downgrade/upgrade behavior.
- Exercise MFA login, recovery code consumption, replay rejection, lockout expiry and concurrent attempts in integration tests.
- Run frontend production build and browser E2E.
- Security review of recovery-code handling and operational SECRET_KEY rotation procedure.
- MFA is optional per account; enforcement for all accounts remains an administrator policy decision.


## v5.45.0 — MFA concurrency hardening and operational readiness (implemented in source)
- Serialize setup, enable, disable and recovery-code rotation by acquiring a PostgreSQL row lock on the account before state checks and writes.
- Add regression tests covering sensitive-route locking, tenant-isolation suite presence, backup/restore safety guards and CI gates.
- Document an operator-led backup and restore rehearsal; no automatic destructive restore or database deletion is introduced.
- No migration; current head remains `0045_mfa_and_login_lockout`.

## v5.45 remaining release gates
- Execute full backend CI and frontend typecheck/build/E2E in the configured GitHub Actions environment.
- Run MFA concurrent-attempt tests against PostgreSQL (SQLite ignores row locks).
- Perform a real encrypted off-host backup and restore rehearsal on a disposable PostgreSQL database.
- Review dependency-audit findings and obtain an independent security assessment before describing the system as penetration-tested or certified.
