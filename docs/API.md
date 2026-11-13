# API reference

All `/api/v1/*` routes except register/login require `Authorization: Bearer <JWT>`. Interactive OpenAPI docs are at `/docs`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login |
| GET | `/api/v1/me` | Current user |
| GET/PUT | `/api/v1/profile` | Read/update profile |
| GET/POST | `/api/v1/opportunities` | List/create opportunities |
| GET | `/api/v1/opportunities/{id}` | Opportunity details |
| POST | `/api/v1/discovery/rss` | Import public HTTPS RSS feed |
| GET | `/api/v1/proposals` | List proposals |
| POST | `/api/v1/proposals/generate` | Generate proposal draft |
| PUT | `/api/v1/proposals/{id}` | Edit proposal; invalidates prior approvals |
| POST | `/api/v1/proposals/{id}/request-approval` | Create approval request |
| GET | `/api/v1/approvals` | List approval records |
| POST | `/api/v1/approvals/{id}/decision` | Approve/reject exact proposal version |
| POST | `/api/v1/applications/{proposal_id}/mark-ready` | Mark approved draft ready for manual submission; does not send |
| GET/POST | `/api/v1/projects` | List/create projects |
| GET/POST | `/api/v1/invoices` | List/create invoice records |
| PATCH | `/api/v1/invoices/{id}/status` | Update invoice status (paid/unpaid/overdue/cancelled) |
| GET | `/api/v1/dashboard` | Summary metrics |
| GET | `/api/v1/agents/runs` | Agent activity log |

Money values are numeric amounts in the supplied currency. The platform does not implement exchange-rate conversion, tax calculations, payment gateways or outbound invoice email. v5.1.0 adds a manual evidence ledger for invoice receipts/refunds; it is not bank verification.


## Release 0.2 endpoints
- `POST/GET /api/v1/tasks`, `PATCH /api/v1/tasks/{id}`
- `POST/GET /api/v1/milestones`, `PATCH /api/v1/milestones/{id}`
- `POST/GET /api/v1/research`
- `POST/GET /api/v1/feedback`
- `POST/GET /api/v1/portfolio/documents`, `POST /api/v1/portfolio/search`
- `GET /api/v1/notifications`, `POST /api/v1/notifications/test-telegram`
- `GET /api/v1/invoices/{id}/pdf`
- `GET /api/v1/agents/registry`, `GET /api/v1/agents/learning-summary`
- `POST /api/v1/integrations/n8n/event` (shared secret header)

- `POST/GET /api/v1/sources`, `PATCH /api/v1/sources/{id}?enabled=true|false`
- `POST /api/v1/integrations/n8n/discover` (requires `X-FIA-Webhook-Secret` and `X-FIA-User-ID`)


## Release 0.3 queue and retrieval
- `POST /api/v1/discovery/enqueue`: enqueue RSS discovery for enabled sources; requires Redis and a running RQ worker.
- `GET /api/v1/background-jobs`: list the authenticated user's background jobs.
- `POST /api/v1/portfolio/search?query=...`: return ranked document chunks using embeddings when available, lexical cosine fallback otherwise.


## Release 0.5 profile matching
- `GET /api/v1/opportunities/{id}/recommendation`: non-binding price guidance based on profile rate, estimated effort and available listing budget.

## Release 0.6 client research and risk intelligence
- `POST /api/v1/research`: save opportunity-linked evidence; accepted evidence types are `platform_profile`, `client_history`, `contract`, `payment_terms`, `public_review`, `user_note`, and `other`.
- `GET /api/v1/research?opportunity_id=<id>`: list saved evidence.
- `POST /api/v1/research/assess`: create and persist a transparent risk-screening report.
- `GET /api/v1/research/assessments?opportunity_id=<id>`: list saved screening reports.

Risk screening uses keyword rules against listing text and user-supplied evidence. Each signal carries source references where available. It is not an identity check, legal conclusion or guarantee of safety.


## Release 0.7 multi-source discovery
- `POST /api/v1/sources` accepts `source_type` `rss` or `json_api`.
- `GET /api/v1/sources` returns source type and URL.
- `POST /api/v1/discovery/enqueue` queues all enabled source adapters.
- `GET /api/v1/opportunities?source=<source>&min_score=<0-100>&fresh_days=<1-365>` filters opportunities.
- Opportunity records include source provenance, first/last seen timestamps, published timestamp and duplicate count.


## Release 0.8 durable workflows
- `POST /api/v1/workflows` queues matching, evidence summary, pricing advice and proposal drafting for an owned opportunity.
- `GET /api/v1/workflows` lists user-owned workflow runs.
- `GET /api/v1/workflows/{workflow_id}` returns state and ordered node checkpoints.
- `POST /api/v1/workflows/{workflow_id}/resume` completes a paused workflow only after the linked exact proposal has an approved hash.
- `POST /api/v1/workflows/{workflow_id}/retry` retries failed runs without an existing proposal.
- `POST /api/v1/approvals/{approval_id}/decision` updates the linked workflow to approved/rejected in the same transaction.


## Release 0.9 source health and evidence provenance
- `GET /api/v1/sources` includes health status, failure count, last check/success, retry time, item count, latency and last error.
- `POST /api/v1/research` stores the user-entered claim with source hostname and SHA-256 evidence digest.
- `GET /api/v1/research` returns evidence provenance fields.


## Release 1.0 opportunity intelligence
- `GET /api/v1/opportunities/ranked` returns user-owned opportunities ordered by explainable profile/freshness/feedback rank.
- Optional query parameters: `limit` (1–100), `offset` (non-negative), and `source`.
- Each result includes `ranking.rank_score`, component contributions, freshness age, feedback sample count, reasons and ranking version.


## Release 1.1 delivery and revenue
- `POST /api/v1/time-entries` creates a user-owned time entry.
- `GET /api/v1/time-entries?project_id=...` lists time entries.
- `GET /api/v1/delivery/plan/{project_id}` previews delivery recommendations without creating records.
- `GET /api/v1/finance/summary` summarizes paid, outstanding, overdue and near-due invoices.
- `GET /api/v1/analytics/proposals` aggregates manually recorded proposal feedback outcomes.


## Release 1.2 pricing and profitability
- `GET /api/v1/pricing/recommendation/{opportunity_id}` provides an explainable, user-specific price suggestion.
- `GET /api/v1/analytics/pricing-segments` groups recorded priced proposal outcomes by category and relative listing budget.
- `GET /api/v1/projects/{project_id}/profitability` summarizes paid revenue, invoices, tracked hours and a time-value proxy.


## Email intake & follow-up (v1.3)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/emails/intake` | Save an inbound message manually (authenticated, tenant-scoped) |
| GET | `/api/v1/emails` | List the current user's messages |
| POST | `/api/v1/emails/{email_id}/draft` | Create a conservative reply draft |
| GET | `/api/v1/email-drafts` | List reply drafts and approval states |
| PUT | `/api/v1/email-drafts/{draft_id}` | Edit a draft before approval |
| POST | `/api/v1/email-drafts/{draft_id}/request-approval` | Submit the saved exact content for approval |
| POST | `/api/v1/email-drafts/{draft_id}/decision` | Approve or reject; approval does not send |
| POST | `/api/v1/follow-ups` | Create a reminder |
| GET | `/api/v1/follow-ups` | List reminders |
| PATCH | `/api/v1/follow-ups/{reminder_id}/complete` | Complete a reminder |

Email intake requires a valid bearer token. Optional opportunity/project IDs must belong to the authenticated user. Provider `gmail`/`outlook` values are labels only, not live integrations.


## Email provider integrations (v1.4)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/email-integrations` | List connected provider accounts (never returns tokens) |
| GET | `/api/v1/email-integrations/{google\|microsoft}/connect` | Return provider authorization URL; browser must navigate to it |
| GET | `/api/v1/email-integrations/callback/{google\|microsoft}` | OAuth callback; state and PKCE verified |
| POST | `/api/v1/email-integrations/{google\|microsoft}/sync` | Import recent inbox messages; idempotent by provider message ID |
| DELETE | `/api/v1/email-integrations/{google\|microsoft}` | Delete local credentials; Google revocation attempted |
| POST | `/api/v1/email-drafts/{draft_id}/send` | Send an approved, unchanged draft to the original sender |

OAuth setup requires `OAUTH_ENCRYPTION_KEY`, provider client ID/secret and exact registered redirect URI. Configure these in `.env`; never commit secrets. Gmail sync imports up to 50 messages from the last 30 days. Outlook sync imports up to 50 recent messages. Provider push notifications and incremental sync cursors are not included yet.

The approval digest binds the exact subject, body, original sender address and provider. Only provider-synchronized messages (`provider_verified=true`) can be sent; manual intake remains draft-only. Approval is not sending: a separate send action is mandatory. A network timeout changes the draft to `send_unknown`; inspect the provider's Sent folder and do not automatically retry.


## Communication intelligence (v1.5)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/emails/{email_id}/intelligence` | Explainable urgency/sentiment indicators, project matches and follow-up recommendation |
| POST | `/api/v1/emails/{email_id}/analyze` | Recalculate and persist indicators/project suggestion for legacy inbox messages |
| PATCH | `/api/v1/emails/{email_id}/link-project` | Explicitly confirm or clear a project association (`{"project_id":"..."}` or null) |
| POST | `/api/v1/emails/{email_id}/create-follow-up` | Create an in-app reminder from the suggested cadence; returns an existing open reminder instead of duplicating it |
| POST | `/api/v1/emails/{email_id}/draft` | Generate a contextual reply using profile, project, recent sender history and retrieved portfolio chunks |

Email list records now include sentiment, evidence terms, urgency score/reasons, and a suggested project ID/score. Suggestions are not confirmed associations.

Draft records include `generation_mode`, `context_sources`, and `grounding_note`. The model prompt prohibits unsupported prices, deadlines, guarantees and achievements; nevertheless, review every claim before approval. If model generation fails, a safe clarification-oriented template is saved.

Urgency/sentiment are deterministic keyword indicators with visible evidence, not definitive emotional analysis. Follow-up cadence is advisory and no reminder is created until the explicit POST action. No automatic email is sent by the follow-up feature.

Contextual draft generation is bounded by a 35-second timeout; if AI is unavailable or times out, the endpoint saves the safe fallback template. Embedding lookup is bounded by 5 seconds and falls back to lexical retrieval if unavailable or dimension-incompatible.


## Release 1.6 marketplace pipeline
- `GET /api/v1/marketplaces`: provider capability and connection readiness.
- `PUT /api/v1/marketplaces/{provider}/settings`: save non-secret access mode metadata.
- `POST/GET /api/v1/marketplace-applications`: create/list opportunity application tracking records.
- `POST /api/v1/marketplace-applications/{id}/approve`: approve the exact proposal hash.
- `POST /api/v1/marketplace-applications/{id}/record-submission`: record a submission already made manually outside this app.
- `PATCH /api/v1/marketplace-applications/{id}/status`: update manually tracked outcome.
- `GET /api/v1/marketplace-applications/{id}/audit`: view immutable-style event history.

No v1.6 endpoint sends or submits a proposal to a marketplace.


## Release 1.7 delivery and finance
- `POST/GET /api/v1/projects/{project_id}/deliverables`
- `PATCH /api/v1/deliverables/{deliverable_id}`
- `POST /api/v1/deliverables/{deliverable_id}/submit-for-review`
- `POST /api/v1/deliverables/{deliverable_id}/review` — requires the current `review_hash` and `decision` (`approve` or `request_changes`).
- `POST /api/v1/deliverables/{deliverable_id}/record-delivery` — records an already completed external handover; does not send.
- `PATCH /api/v1/deliverables/{deliverable_id}/client-status` — `accepted` or `changes_requested`.
- `GET /api/v1/deliverables/{deliverable_id}/revisions`
- `GET /api/v1/projects/{project_id}/delivery-summary`
- `POST /api/v1/projects/{project_id}/invoice-schedules`
- `GET /api/v1/invoice-schedules`
- `POST /api/v1/invoice-schedules/{schedule_id}/approve` — requires `approval_hash`.
- `POST /api/v1/invoice-schedules/{schedule_id}/issue` — creates an invoice record only after approval.
- `GET /api/v1/finance/cashflow-forecast?horizon_days=90` — horizon 7–365 days.


## Release 1.8 business intelligence
- `GET /api/v1/analytics/funnel`
- `GET /api/v1/analytics/source-performance`
- `GET /api/v1/analytics/source-trends` — rolling 30/90/180-day source activity and linked payment receipt/refund totals.
- `GET /api/v1/analytics/capacity?lookback_days=28`
- `GET /api/v1/analytics/project-profitability`
- `GET /api/v1/analytics/earnings-outlook?horizon_days=90`
- `PUT /api/v1/projects/{project_id}/origin-opportunity` with `{ "opportunity_id": "<owned opportunity id>" }` or null to unlink.


## v2.1 Business Coach

### `POST /api/v1/coach/ask`
Authenticated request body: `{"question":"..."}`. The question must be 1–2,000 characters. Response includes `answer`, `sources` (IDs, types and excerpts), `generation_mode`, and a human-approval policy note.

### `GET /api/v1/coach/history?limit=20`
Returns recent coach questions, answers, source excerpts and generation mode for the authenticated user. `limit` is 1–100.


## Release 2.4 — durable multi-agent workflows

- `POST /api/v1/agent-workflows` — queue `business_review`, `opportunity_plan`, `delivery_review` or `finance_review`. Optional per-user `idempotency_key` prevents duplicate run creation.
- `GET /api/v1/agent-workflows` — list the current user's multi-agent runs.
- `GET /api/v1/agent-workflows/{workflow_id}` — return result and ordered SQL checkpoints.
- `POST /api/v1/agent-workflows/{workflow_id}/retry` — retry a failed or stale run, up to three total attempts.

These workflows require Redis/RQ. They read saved records and generate recommendations only. They do not send emails, submit proposals, deliver files, issue invoices or move money.


## Release 2.5 — proposal and communication specialist agents

The existing `POST /api/v1/agent-workflows` endpoint now runs proposal strategy and communication planning stages as part of `business_review` and proposal strategy as part of `opportunity_plan`. Results are included in `proposal_strategy` and `communication` fields returned by `GET /api/v1/agent-workflows/{workflow_id}`. Workflow checkpoint responses expose keys and counts, not raw saved email bodies or portfolio text.

Proposal strategist output is a preview only; it is not persisted as a Proposal record. Client communication output is a plan only; it does not create an EmailDraft or FollowUpReminder. Use the existing proposal and email endpoints to create editable records and request their separate hash-bound approvals.


## Release 2.6 — Agent operations
- `POST /api/v1/agent-workflows/{workflow_id}/cancel` — cancel a queued/running run; durable writes are fenced.
- `GET /api/v1/agent-workflows/metrics/summary` — current user's recent workflow status and measured agent-step metrics.
- `POST /api/v1/agent-workflows/retention/cleanup` — dry-run-first cleanup of terminal workflow history. Request body: `{"older_than_days":90,"dry_run":true}`.
- Workflow detail/list responses now include stable `error_code` and `last_error_node` fields when a run fails.


## Release 2.7 — agent failure diagnostics
Workflow list/detail responses include `error_code` and `last_error_node` after an agent node fails. These fields identify a stable failure category and the graph stage; they do not include raw account snapshots. RAG grounding evaluation is an offline CLI, not a public API endpoint.

The offline grounding report is generated with `backend/scripts/evaluate_rag_grounding.py`; it is intentionally not exposed as a public endpoint.


## Release 2.8 — offline RAG citation validation
The evaluator remains an offline CLI, not a public API. It validates benchmark structure, checks each cited evidence ID against the evidence supplied for that claim, reports unknown citation IDs and forces those claims to unsupported in the lexical proxy. Run from `backend/`: `python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json`. Use `--strict` only for independently human-reviewed data with reviewer provenance.


## Release 3.4 — AI usage

- `GET /api/v1/usage/ai` — authenticated account's UTC daily/monthly AI operation usage, configured limits and remaining calls. It reports character counts in stored events; token and cost reporting are intentionally not claimed.
- Quotas currently apply to model-backed proposal generation, client email reply drafting and business coach answers. Rules-based fallbacks are not counted as successful AI usage.


## Action planner

`GET /api/v1/agent/action-plan?limit=12` returns a bounded, prioritized action queue for the authenticated account. It aggregates recorded invoice, task, reminder, opportunity, project, milestone, deliverable, invoice-schedule, proposal-approval, email-draft and marketplace-application state. Each action includes its evidence type/id, reason, suggested next step and a human-approval flag. The endpoint is advisory and does not execute external or irreversible actions. `limit` is between 1 and 50.


## Client CRM and scope changes

- `POST /api/v1/clients`, `GET /api/v1/clients`, `PATCH /api/v1/clients/{client_id}` manage account-owned client profiles.
- `PUT /api/v1/projects/{project_id}/client` links a project to a client in the same account.
- `GET /api/v1/clients/{client_id}/activity` returns project-linked activity only; unlinked records are not inferred.
- `POST /api/v1/projects/{project_id}/scope-changes` creates a draft.
- `POST /api/v1/scope-changes/{change_id}/request-approval` fingerprints and submits it.
- `GET /api/v1/scope-changes` lists account-owned changes.
- `POST /api/v1/scope-changes/{change_id}/decision` accepts `approved` or `rejected`, the exact `request_hash`, and a client-acceptance attestation plus written-acceptance reference for approval. Approval applies the budget and due-date deltas only after validation.

## Client operations (v4.9.0)
- `POST /api/v1/client-contracts` — create a client-linked contract/SOW draft.
- `GET /api/v1/client-contracts?client_id=...` — list the authenticated user's contract records.
- `POST /api/v1/client-contracts/{contract_id}/decision` — record sent/accepted/rejected/expired/archived status using the current content hash; acceptance requires written-evidence details.
- `POST /api/v1/client-communications` — manually log a client communication event.
- `GET /api/v1/clients/{client_id}/profitability` — aggregate linked invoice and time-entry data, keeping currencies separate.

These endpoints do not send documents or messages, obtain digital signatures, or process payments. Profitability is a recorded-data estimate, not an accounting statement.

## Immutable contract and delivery history (v5.0.0)
- `POST /api/v1/client-contracts/{contract_id}/revisions` — create a new immutable contract snapshot; resets the current record to draft and invalidates prior acceptance status.
- `GET /api/v1/client-contracts/{contract_id}/revisions` — return ordered snapshots and `chain_valid` integrity result.
- `GET /api/v1/deliverables/{deliverable_id}/acceptance-history` — return acceptance/change-request records with revision number, content hash, note and owner-entered evidence reference.
- `PATCH /api/v1/deliverables/{deliverable_id}/client-status` — now also stores an immutable acceptance-history event; optional `evidence_reference` is owner-entered text.

These are workspace records and integrity checks, not legal e-signatures or independent verification of the client's identity.


## Payment reconciliation (v5.1.0)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/invoices/{invoice_id}/payment-events` | Append a manual receipt, refund, dispute-opened or dispute-resolved evidence event |
| GET | `/api/v1/invoices/{invoice_id}/payment-events` | Read invoice balance, event history and dispute count |
| GET | `/api/v1/payment-reconciliation` | Workspace reconciliation totals grouped by currency |

Payment receipt/refund events require a positive amount, exact invoice currency, and evidence reference. Refunds cannot exceed net recorded receipts. Dispute events carry zero amount. Events are append-only; no edit/delete or payment initiation endpoint exists. Currency conversion is not performed. A manually entered event is not independently bank-verified.


## Client business intelligence (v5.2.0)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/clients/{client_id}/costs` | Record a direct client/project cost |
| GET | `/api/v1/clients/{client_id}/costs` | List manually recorded costs |
| GET | `/api/v1/clients/{client_id}/insights` | Explainable relationship-health and payment-behavior summary |
| GET | `/api/v1/clients/{client_id}/profitability` | Invoice, net receipts, labor proxy, direct costs and cash contribution by currency |

Direct costs require a positive amount, ISO date, and a project (if supplied) must belong to the same user and client. Financial metrics do not combine currencies or estimate missing costs. The relationship-health score is a rule-based heuristic, not a credit score or default prediction.


## Opportunity intelligence (v5.3.0)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/opportunity-intelligence` | Current-profile rescoring, explainable ranking, eligibility warnings, source provenance and review state |
| POST | `/api/v1/opportunities/{opportunity_id}/review` | Save shortlist decision, notes and next-action date |
| GET | `/api/v1/opportunities/reviews` | List saved review records |

Query parameters for opportunity intelligence: `limit` (1–100), `min_score` (0–100), `max_age_days` (1–365), `source`, and `decision`. Review decisions: `saved`, `interested`, `proposal_ready`, `revisit`, `dismissed`.

Marketplace provider readiness settings are non-secret metadata. v5.7.0 implements an account-scoped, read-only Upwork GraphQL search after OAuth consent and approved API scope. Freelancer.com remains unimplemented. Existing RSS/Atom and permitted public JSON feed connectors remain available. No marketplace proposal submission is enabled.


## Release 5.4 marketplace readiness
- `GET /api/v1/marketplaces/{provider}/readiness`: returns adapter availability, account readiness metadata, official documentation URL, and explicit `live_api_verified` / `submission_enabled` flags. Unknown providers return 404.
- `PUT /api/v1/marketplaces/{provider}/settings`: accepts only `manual`, `permitted_feed`, and `official_api_pending`. `official_api_configured` is rejected with HTTP 409; this endpoint cannot create a live connection.

The Upwork adapter exposes only `read_only_opportunity_search`; it requires a user's approved API key, OAuth authorization and marketplace-read permission. Freelancer remains fail-closed. No proposal submission is enabled.


## Marketplace credential vault (v5.5.0)

- `GET /api/v1/marketplaces/{provider}/credential-status` returns only non-secret credential metadata for `upwork` or `freelancer`.
- `DELETE /api/v1/marketplaces/{provider}/credentials` deletes the authenticated account owner's locally stored encrypted credential material. Provider-side authorization must be revoked separately.
- No public endpoint accepts raw provider tokens. The internal credential vault service is reserved for a future callback after provider-specific OAuth state/PKCE validation and official token exchange.
- A stored credential is `stored_unverified`; it does not prove provider identity or live API access.


## Upwork OAuth (v5.6.0)

- `POST /api/v1/marketplaces/upwork/oauth/start` — authenticated; returns the provider authorization URL.
- `GET /api/v1/marketplaces/upwork/oauth/callback` — provider callback; validates one-time state and exchanges the code using PKCE.
- `POST /api/v1/marketplaces/upwork/oauth/refresh` — authenticated; refreshes stored access token when requested.
- `GET /api/v1/marketplaces/upwork/credential-status` — returns metadata only.
- `DELETE /api/v1/marketplaces/upwork/credentials` — deletes local encrypted token material. Revoke authorization at Upwork separately.

Required environment: `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`, `UPWORK_REDIRECT_URI`, `UPWORK_SCOPES` (only scopes approved for your API key), and `OAUTH_ENCRYPTION_KEY`. Set the exact callback URL in Upwork developer settings. The callback stores encrypted tokens but does not query a profile or GraphQL endpoint; status remains `stored_unverified`, and `live_api_verified` remains false. The OAuth refresh endpoint is a manual operation; automatic refresh scheduling is not enabled.

Freelancer.com API access is not implemented in this release because the public developer landing page alone does not establish the app's approved auth flow, scopes, or API credentials. No assumptions are made about those details.


## Upwork read-only discovery (v5.7.0)

- `POST /api/v1/marketplaces/upwork/discovery/search` — authenticated; body: `{"search_term":"python automation","limit":20,"cursor":null}`. `search_term` is 2–160 characters, `limit` is 1–50, and `cursor` is an optional provider page cursor. Executes the documented `marketplaceJobPostingsSearch` GraphQL query, maps the returned listing fields, and imports them through the existing account-scoped opportunity deduplication and profile scoring service.
- Response includes `total_count`, `returned`, `created`, `duplicates_refreshed`, `has_more`, `next_cursor`, and imported opportunity IDs/match scores. Send `next_cursor` in the next request to continue paging.
- A successful GraphQL response updates the authenticated user's Upwork connection to `api_verified`. OAuth token storage alone remains `stored_unverified`.
- HTTP 409 indicates missing/invalid authorization or insufficient approved scopes; HTTP 429 indicates provider rate limiting; HTTP 502 indicates provider/network/schema failure.
- The app omits `X-Upwork-API-TenantId` so Upwork uses the authenticated user's default organization context. This avoids applying a single global organization ID to multiple accounts.
- No source URL is fabricated when the search response does not include a verified browser URL. Payment verification is unknown when the selected API fields do not provide it.
- The endpoint is read-only. It never creates, approves, or submits a marketplace application.
- `UPWORK_CACHE_RETENTION_ENABLED=true` is required to enable discovery, and must be set only after an hourly retention task is configured. The default is false. A 22-hour cleanup cutoff redacts cached listing content; the cleanup command is `cd backend && python -m app.retention_cleanup`. The included GitHub Actions workflow expects `PRODUCTION_DATABASE_URL`; a Render Cron Job can be used when the database is private to Render.

Official API endpoint and operation are documented by Upwork at https://www.upwork.com/developer/documentation/graphql/api/docs/index.html. API access, scopes and approval remain subject to Upwork's current developer requirements and terms.


## Saved marketplace searches (v5.8.0)

All routes require the authenticated user's bearer token and are scoped to that user. Only the verified Upwork read-only adapter is currently supported.

- `GET /api/v1/marketplaces/saved-searches` — list saved search configurations and run metadata.
- `POST /api/v1/marketplaces/saved-searches` — create `{ "search_term": "Python automation", "result_limit": 20, "interval_hours": 24, "is_active": true }`. Intervals are restricted to 6, 12 or 24 hours; result limit is 1–50.
- `PATCH /api/v1/marketplaces/saved-searches/{search_id}` — update keywords, page size, interval or active state.
- `DELETE /api/v1/marketplaces/saved-searches/{search_id}` — delete the user's saved search.
- `POST /api/v1/marketplaces/saved-searches/{search_id}/run` — run immediately and import results.

The scheduled runner is `python -m app.scheduled_discovery` from `backend/`. The included GitHub Actions workflow invokes it every 15 minutes using `PRODUCTION_DATABASE_URL`, `OAUTH_ENCRYPTION_KEY`, `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`, `UPWORK_REDIRECT_URI`, and `UPWORK_SCOPES` repository secrets. The separate hourly `upwork-cache-retention.yml` workflow must also be deployed. The scheduled workflow reads the GitHub repository variable `UPWORK_CACHE_RETENTION_ENABLED` and skips safely while it is unset/false. Keep it false until both scheduled workflows have been tested successfully on staging. Search scheduling never submits proposals. Apply Alembic migration `0029_saved_marketplace_searches`.

## Delivery performance analytics (v5.27.0)

`GET /api/v1/analytics/delivery-performance` (authenticated)

Returns task-level actual logged hours, estimate variance, recorded completion timestamp and schedule variance, plus project-level descriptive summaries. Actual hours use only time entries linked to a task. Missing time logs, estimates or legacy completion timestamps are reported as unknown. No task dates are changed by this endpoint.


## Adaptive effort suggestions (v5.28.0)

`GET /api/v1/analytics/adaptive-effort` — authenticated, user-scoped, read-only. Uses completed tasks and task-linked time entries to return effort suggestions for open tasks, with sample size, confidence, historical range and matched examples. Returns no numeric suggestion when fewer than two similar completed records are available. No database migration is required.


## Delivery quality analytics (v5.30.0)

`GET /api/v1/analytics/delivery-quality?minimum_sample=3` — authenticated, user-scoped, read-only summary of explicit deliverable client decisions, timestamp-grounded acceptance-cycle observations, revision-version associations and separately reported project scope changes. `minimum_sample` is an integer from 1 to 100 (default 3); acceptance rates are omitted below it.


## Post-closeout archive lifecycle and recovery (v5.41.0)

- `GET /api/v1/archive-manifests/{manifest_id}/verification-report` — manifest, component, approved snapshot, sign-off, closure and evidence-reference integrity details.
- `GET /api/v1/archive-manifests/{manifest_id}/evidence-report` — compares archived reference strings to current source records; does not fetch linked files.
- `GET /api/v1/archive-manifests/{manifest_id}/bundle.zip` — verified ZIP containing manifest JSON, approved handover JSON/PDF, project outcome JSON, verification report and SHA-256 checksums.
- `POST /api/v1/archive-manifests/{manifest_id}/supersede` — records an append-only link to a newer archive for the same project; no manifest is edited or deleted.
- `GET /api/v1/projects/{project_id}/archive-supersessions` — lists supersession relationships.
- `GET /api/v1/archive-manifests/{manifest_id}/recovery-checklist` — returns the manual recovery rehearsal checklist.
- `POST /api/v1/projects/{project_id}/recovery-rehearsals` — records operator-reported recovery evidence.
- `GET /api/v1/projects/{project_id}/recovery-rehearsals` — lists prior rehearsal records.

Recovery rehearsal records do not execute or independently verify a database restore. Archive evidence hashes fingerprint reference strings, not the contents of linked documents.


## Runtime diagnostics (v5.42.0)

- `GET /health` — public process health and application version; does not prove dependencies are ready.
- `GET /ready` — readiness probe; in production checks PostgreSQL, Redis, production configuration and Alembic head `0043_archive_bundle_and_supersession`.
- `GET /api/v1/system/diagnostics` — operator diagnostics protected by `X-Diagnostics-Key` (requires `DIAGNOSTICS_API_KEY`). Reports database/migration status, Redis, RQ queue counts, active worker heartbeat, AI provider status and production configuration warnings. It never returns credentials or provider URLs.

OpenAI-compatible providers are not actively probed by this endpoint to avoid incurring billable requests. Ollama is checked with a lightweight `/api/tags` request. Diagnostics must be called from a trusted operator environment; do not place the key in frontend code.


## Account security and authentication (v5.43.0)

- `POST /api/v1/auth/register` — creates an account. In production, email verification is required and a verification link is sent; local development can explicitly disable verification.
- `POST /api/v1/auth/verify-email` — consumes a single-use verification token.
- `POST /api/v1/auth/resend-verification` — enumeration-safe resend request.
- `POST /api/v1/auth/password-reset/request` — enumeration-safe password reset request.
- `POST /api/v1/auth/password-reset/confirm` — consumes a single-use 30-minute reset token and revokes existing sessions.
- `POST /api/v1/auth/password/change` — verifies the current password, changes it and revokes previous sessions; returns a replacement access token.
- `GET /api/v1/auth/sessions` — lists the account's recent sessions.
- `DELETE /api/v1/auth/sessions/{session_id}` — revokes one account-owned session.
- `POST /api/v1/auth/logout` — revokes the current session.
- `POST /api/v1/auth/logout-all` — revokes all sessions.

Access tokens contain a session ID (`jti`) and are checked against `auth_sessions` on every authenticated request. Tokens issued before this release do not have a persisted session ID and must be replaced by signing in again. Email action tokens are single-use and only SHA-256 digests are stored.


## Multi-factor authentication (v5.44.0)

- `POST /api/v1/auth/mfa/setup` — authenticated; requires current password. Returns a TOTP secret, `otpauth://` provisioning URI and ten recovery codes once. The user must save the recovery codes securely.
- `POST /api/v1/auth/mfa/enable` — authenticated; confirms setup with a current six-digit TOTP.
- `GET /api/v1/auth/mfa/status` — authenticated; reports whether MFA is enabled and the number of unused recovery codes.
- `POST /api/v1/auth/mfa/verify-login` — accepts the short-lived challenge token returned by login and a TOTP or unused recovery code.
- `POST /api/v1/auth/mfa/disable` — authenticated; requires password and TOTP/recovery code; revokes all active sessions.
- Login locks an account for the configured interval after the configured number of incorrect passwords. Defaults: eight failures and 15 minutes.
- MFA challenge defaults: five minutes and five failed code attempts. TOTP time-step replay is rejected.

MFA secrets are encrypted at rest with a key derived from `SECRET_KEY`; preserve that setting. Changing `SECRET_KEY` invalidates existing sessions and prevents decrypting MFA secrets. Keep recovery codes offline. MFA is opt-in per user in this release.

- `POST /api/v1/auth/mfa/recovery-codes/rotate` — authenticated; requires current password plus a valid TOTP or unused recovery code. Invalidates all old recovery codes and returns ten new codes once.
