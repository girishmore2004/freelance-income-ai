# API Contract Status

Envelope (Edge): `{ success, message, data, error: {code, details} | null, meta }`. The frontend helpers unwrap `data`. Python returns bare objects; both are accepted by `frontend/lib/api-client.ts`.

## Frontend pages vs the deployed Edge API (2026-11-17)

| Page | Route references | Served by Edge | Missing (Python-only) |
|---|---|---|---|
| `/` (home) | 61 | 31 | 30 |
| `/analytics` | 33 | 6 | 27 |
| `/delivery` | 13 | 2 | 11 |
| `/clients` | 9 | 2 | 7 |
| `/marketplaces` | 9 | 1 | 8 |
| `/security` | 9 | 6 | 3 |
| `/opportunity-intelligence` | 5 | 3 | 2 |
| `/agent-workflows` | 3 | 0 | 3 |
| `/client-insights` | 3 | 1 | 2 |
| `/workspace` | 3 | 0 | 3 |
| `/coach` | 2 | 0 | 2 |
| `/payments` | 2 | 1 | 1 |
| `/agent` | 1 | 0 | 1 |

Do not change `NEXT_PUBLIC_API_URL`/proxy targets per page until its families are served.

**Legacy page status (5.65.0)** — the table above is the original audit.

| Page | State now |
|---|---|
| `/security` | Works: every call is served by the Edge API (sessions, MFA, password, sign-out everywhere). |
| `/workspace`, `/agent`, `/coach` | Works: ported to Edge (`business-routes.ts`) and extended with marketplace data. |
| `/delivery`, `/analytics`, `/clients`, `/client-insights`, `/agent-workflows`, `/marketplaces`, `/opportunity-intelligence`, `/payments` | Behind `LegacyGate`: a clear notice with links to the marketplace pages that do the same job, instead of failing calls. Build variable `NEXT_PUBLIC_LEGACY_PYTHON_PAGES=true` shows the original page (useful only once its routes are served; D-11). |
| `/` (home) | Works for the Edge-served parts; some older widgets (tasks, milestones, invoices, research) still show "not available on Edge" (501). |

**Public browse (5.67.0, no login):** `GET /marketplace/listings` and `GET /marketplace/listings/{id}` and `GET /project-categories` now answer visitors (public listings only; invite-only listings need the invited session); `GET /public/freelancers?q=&offset=` → `{open, items[card + completed_contracts], more}`; `GET /public/freelancers/{id}` → card + `completed_contracts` + `reviews[{rating, comment, created_at}]` (revealed client reviews only).

**Public home (5.66.0, no login):** `GET /public/home` → `{client_marketplace_open, categories[{slug, name, open}], agents[{code, name, side, purpose, status}], counts: {published_projects, visible_freelancers, completed_contracts} | null}`.

**Business workspace (5.65.0):** `GET/PUT /business-goals`, `GET /workspace/overview` (adds `active_contracts_as_freelancer`, `active_contracts_as_client`, `deliveries_awaiting_client`, `deliveries_to_review`, `released_this_month_minor`; legacy counts are `null` when that kind of record is unavailable), `GET /workspace/events`, `GET /agent/action-plan?limit=` (`{as_of_date, actions[{priority, category, title, reason, evidence, suggested_action, due_date, requires_human_approval, href}], total_actionable_records, returned_actions, policy}`), `POST /coach/ask {question}` (`generation_mode: llm_grounded_context | rules_fallback`, `citation_validation`), `GET /coach/history`. All responses use the standard envelope.

## Route-family ownership (proposed with ADR-006 option A)

| Family | Owner now | Status |
|---|---|---|
| `/auth/*`, `/me` | Edge | Parity with Python (this batch) |
| `/profile`, `/dashboard`, `/opportunities*`, `/proposals*`, `/approvals*` | Edge | Implemented |
| `/applications*`, `/integrations/*` (Gmail) | Edge | Implemented; tables migrated in 0047 |
| `/discovery/run`, `/discovery/draft`, `/discovery/status`, `/discovery/refresh`, `/background-jobs` | Edge | `/discovery/refresh` + `/background-jobs` new this batch |
| `/projects`, `/tasks`, `/invoices` (basic) | Edge | Partial |
| `/workflows`, `/milestones`, `/research*`, `/portfolio/*`, `/sources`, `/agents/registry`, `/notifications`, `/emails`, `/email-drafts`, `/follow-ups` | Python only | Edge now returns **501 NOT_AVAILABLE_ON_EDGE** (previously fake empty lists) |
| Delivery governance, analytics, finance intelligence, CRM | Python only | Not ported |
| Payment provider (live), live payouts | — | BLOCKED (D-1/D-2); sandbox funding, payouts, refunds, disputes and admin are on Edge |

## Phase 2 endpoints (Edge 5.49.0, behind `marketplace.client_side`)
`GET /project-categories`; `POST /organizations/{org}/brief-assistant {category_slug, notes}` → `{draft, source: "model"|"template", note?}` (not stored); `GET|POST /organizations/{org}/listings`; `GET /listings/{id}` (with version history); `PUT /listings/{id} {base_version, ...brief}` → new version (409 `VERSION_CONFLICT` / `NOT_EDITABLE`); `POST /listings/{id}/transition {action: submit|pause|resume|close|cancel}` (owner/admin; 409 `INVALID_TRANSITION`; 422 `INCOMPLETE_BRIEF` with `details[0].gaps`); `GET /marketplace/listings?category=&q=&before=` → `{items, next_before}`; `GET /marketplace/listings/{id}`. Money fields are integer minor units (`budget_min_minor`, `budget_max_minor`). Marketplace items never include organisation ids, billing data, ownership notes or assumptions; confidential briefs show "Confidential client" and no description. Listings accept an optional `closes_at` (YYYY-MM-DD, tomorrow to 180 days; 422 field error `closes_at`); a closing-date-only edit does not create a new version.

**Matching and invitations (5.50.0, Edge only, behind `marketplace.client_side`):** `GET|PUT /me/marketplace-profile {visible}` (opt-in; 403 `FREELANCER_ROLE_REQUIRED`, 422 `PROFILE_INCOMPLETE`); `GET /me/invitations`; `POST /me/invitations/{id}/respond {response: accept|decline}` (409 `ALREADY_ANSWERED` / `LISTING_CLOSED`); `GET /listings/{id}/matches` → `{candidates_considered, method: "deterministic", matches[{freelancer, score, breakdown, reasons, missing_skills, newcomer_slot, invitation_status, saved}]}`; `GET|POST /listings/{id}/invitations {freelancer_user_id, message, match_score?}` (owner/admin; 409 `ALREADY_INVITED` / `LISTING_NOT_OPEN` / `LISTING_PRIVATE` / `LIMIT_REACHED`; 422 `MESSAGE_NOT_ALLOWED` for contact or payment details); `POST /listings/{id}/invitations/{inv}/withdraw`; `GET|POST /organizations/{org}/saved-freelancers`, `DELETE /organizations/{org}/saved-freelancers/{userId}`. Freelancer cards contain only name, headline, skills, services, hourly rate, hours, timezone and a newcomer flag.

**Proposals and contracts (5.51.0, Edge only, behind `marketplace.client_side`):** `POST /marketplace/listings/{id}/proposals {cover_letter, price_minor, estimated_days?}` (403 `FREELANCER_ROLE_REQUIRED`, 404 hidden/own listing, 409 `LISTING_NOT_OPEN` / `ALREADY_PROPOSED`, 422 `INVALID_PROPOSAL`); `GET /me/proposals`; `PUT /listing-proposals/{id}`; `POST /listing-proposals/{id}/withdraw`; `GET /listings/{id}/proposals`; `POST /listing-proposals/{id}/status {action: shortlist|decline}`; `POST /listing-proposals/{id}/offer {terms}` → contract (201). Native proposals use `/listing-proposals/…` so the existing `/proposals/…` routes for external opportunities are unchanged. `GET /contracts`; `GET /contracts/{id}` → `{status, party, terms, versions, allowed_actions, funding: {available: false, message}}`; `POST /contracts/{id}/accept {version}` (409 `VERSION_CONFLICT` / `ALREADY_ACCEPTED` / `CONTRACT_CLOSED`); `POST /contracts/{id}/versions {base_version, terms}`; `POST /contracts/{id}/decline` (freelancer); `POST /contracts/{id}/withdraw` (client owner/admin). Terms: `{title, scope, deliverables[], milestones[{title, amount_minor, due_date?}], revision_rounds, acceptance_criteria[], ownership_terms}`; `total_minor` is computed by the server.

**Delivery workspace (5.52.0):** `GET /contracts/{id}/workspace` → `{status, party, can_manage, revision_rounds, milestones[{index, title, amount_minor, due_date, state: pending|submitted|approved|revision_requested, revisions_used, submissions[]}], approved_minor, total_minor, messages[], activity[], funding_note}`; `POST /contracts/{id}/messages {body}` (offered/active; 422 `MESSAGE_NOT_ALLOWED`); `POST /contracts/{id}/milestones/{i}/submit {note, links[]}` (freelancer, active; 409 `MILESTONE_NOT_OPEN`; 422 `INVALID_LINKS` — https only); `POST /contracts/{id}/milestones/{i}/review {decision: approve|request_revision, note}` (client owner/admin; 409 `NOTHING_TO_REVIEW` / `NO_REVISIONS_LEFT`; 422 `NOTE_REQUIRED`) → `{contract_completed}`. Approval never moves money.

**Change orders and reviews (5.53.0):** `POST /contracts/{id}/versions` now also works on active contracts (change order; 422 `INVALID_TERMS` when a delivered milestone's title/amount/position changes); `POST /contracts/{id}/accept {version}` on a pending change → `agreed_version` moves (409 `NO_PENDING_CHANGE`); `POST /contracts/{id}/reject-change` (either party). Contract detail adds `agreed_version`, `pending_change`, `agreed_terms`, `completed_at`. `GET /contracts/{id}/reviews` → `{party, can_review, revealed, mine, theirs, theirs_submitted}`; `POST /contracts/{id}/review {rating 1–5, comment}` (409 `NOT_COMPLETED` / `REVIEW_WINDOW_CLOSED` / `ALREADY_REVIEWED`). Freelancer cards in matches include `rating: {average, count} | null`.

**Finance (5.54.0):** `GET /finance/fee-quote?amount_minor=&currency=` (any signed-in user when the marketplace flag is on; 409 `FEES_NOT_CONFIGURED` until a schedule is approved) → `{client_fee_minor, freelancer_fee_minor, client_pays_minor, freelancer_receives_minor, platform_fee_minor}`; staff only (finance/admin, others get 404): `GET|POST /finance/fee-schedules`, `POST /finance/fee-schedules/{id}/approve` (admin), `GET /finance/trial-balance?mode=sandbox`.

**Plans and AI credits (5.55.0, not behind the marketplace flag):** `GET /plans` (active plans; `price_minor` may be null = not set); `GET /me/plan` → `{plan, plan_ends_at, usage: {today, this_month}, limits: {daily, monthly}, credits, purchases_available: false}`; admin only (others 404): `GET|POST /admin/plans`, `POST /admin/plans/{code}/status {active|retired}` (409 for retiring `free`), `POST /admin/plan-grants {email, plan_code, ends_at?}`, `POST /admin/credit-grants {email, credits 1–10,000, note, grant_id}` (repeat grant id = no-op).

**AI agents (5.56.0):** `GET /agents` → `[{code, name, side, purpose, autonomy_ceiling, human_gate, tools, status: live|partial|planned|blocked, enabled}]`; `GET /agents/registry` (same data in the older dashboard shape, replacing the previous 501); `GET /me/agent-runs?agent=CODE` (last 50, labelled with `agent_code`); `POST /admin/agents/{code} {enabled}` (admin; others 404). A disabled agent's AI calls are refused by the governor and fall back to templates.

**Client assistants (5.57.0, organisation members; 403 `AGENT_DISABLED` when switched off):** `GET /listings/{id}/proposal-comparison` (C3) → `{rows[{proposal_id, freelancer_name, price_minor, budget_fit, estimated_days, timeline_fit, skills_covered, skills_missing, deliverables_mentioned, deliverables_total, rating, invited, notes}], price_range, disclaimer}`; `GET /listing-proposals/{id}/suggested-terms` (C5) → `{terms, missing_terms, note}`; `GET /contracts/{id}/milestones/{i}/acceptance-check` (C6, client side; 409 `NOTHING_DELIVERED`) → `{items[{criterion, mentioned, matched_terms}], summary, note}`.

**Trust and admin (5.58.0):** `POST /reports {target_type: listing|user|proposal|contract_message|review, target_id, reason: spam|scam|off_platform|abuse|prohibited|fake|other, details}` (409 `ALREADY_REPORTED`, 429 at 20 open); `GET /me/reports`. Staff (moderator/admin; others 404): `GET /admin/moderation/listings`, `POST /admin/moderation/listings/{id} {decision: approve|return, note}` (return needs a note; 409 `NOT_IN_REVIEW`), `GET /admin/reports?status=`, `POST /admin/reports/{id} {decision: action|dismiss, note, hide_listing?}` (409 `REPORT_CLOSED`), `GET /admin/overview`. Admin: `POST /admin/flags/{key} {enabled}` (409 `FLAG_LOCKED` for `payments.live`).

**Payments (5.60.0; sandbox only):** `GET /contracts/{id}/payments`; `POST /contracts/{id}/milestones/{i}/fund` (client owner/admin; `Idempotency-Key` header; 409 `PAYMENTS_DISABLED` / `CONTRACT_NOT_ACTIVE` / `ALREADY_FUNDED` / `MILESTONE_APPROVED` / `FEES_NOT_CONFIGURED`) → `{payment, checkout}`; `POST /payments/sandbox/{intentId}/complete {outcome: succeed|fail}`; `POST /payments/webhooks/{provider}` (HMAC-SHA256 hex of the raw body in `X-Signature`, secret `PAYMENT_WEBHOOK_SECRET`; 404 until a live provider is configured); `GET /me/earnings`; `POST /me/payouts {amount_minor, idempotency_key}`; `GET /billing/invoices/{id}`; `POST /contracts/{id}/cancellation {reason}`, `.../cancellation/respond {accept}`, `.../cancellation/withdraw`; staff: `GET /admin/payments`, `POST /admin/payments/{id}/refund {note}`. Milestone review responses add `payment: released|not_funded|pending`. With `payments.require_funding` ON, delivery returns 409 `MILESTONE_NOT_FUNDED`.

**Files (5.64.0):** `GET /contracts/{id}/files` → `{files, uploads_enabled, max_bytes, allowed}`; `POST /contracts/{id}/files` (multipart `file`; 503 `FILES_NOT_CONFIGURED` until the R2 bucket exists); `GET /files/{id}` (binary attachment); `POST /files/{id}/delete`. `POST /contracts/{id}/milestones/{i}/submit` accepts `file_ids` (≤ 10); workspace deliveries include `files`; dispute evidence packs include `files`.

**Teams (5.63.0):** `GET/POST /organizations/{id}/invitations {email, role}` (POST returns `join_path` once), `POST /organizations/{id}/invitations/{inv}/revoke`, `POST /organizations/{id}/members/{userId}/role {role}`, `POST /organizations/{id}/members/{userId}/remove`, `POST /organizations/{id}/transfer-ownership {user_id}`, `GET /organization-invitations/preview?token=`, `POST /organization-invitations/accept {token}`, `GET /me/organization-invitations`, `POST /organization-invitations/{id}/accept|decline`. `GET /me/identity` now also returns `user_id`.

**Disputes and suspensions (5.62.0):** parties — `GET/POST /contracts/{id}/dispute`, `POST /disputes/{id}/statements`, `POST /disputes/{id}/withdraw`; staff — `GET /admin/disputes?status=`, `GET /admin/disputes/{id}` (evidence pack), `POST /admin/disputes/{id}/resolve {resolution: release_funded|refund_funded|no_action, note}` (money outcomes admin-only; same decision re-run is idempotent, a different one is 409), `GET /admin/suspensions?status=`, `POST /admin/users/{id}/suspend {reason}`, `POST /admin/suspensions/{id}/lift {note}`, `POST /admin/suspensions/{id}/appeal {decision: uphold|overturn, note}`; person — `GET /me/suspension`, `POST /me/suspension/appeal {text}`. Any other write by a suspended account returns `403 ACCOUNT_SUSPENDED`.

**Notifications (5.61.0):** `GET /notifications?unread=1` (replaces the previous 501; keeps `title, message, status, created_at` and adds `id, kind, link, read`); `GET /notifications/unread-count`; `POST /notifications/read {ids?}`.

**Public (5.59.0, no login):** `GET /public/pricing` → `{plans | null, fees: {status: approved|not_decided|unavailable, ...}, payments_live, client_marketplace_open}`. `GET /marketplace/listings/{id}` also returns invite-only listings to invited freelancers.

## Phase 1 endpoints (Edge 5.48.0)
`GET /me/identity`, `POST /me/roles {role}`, `DELETE /me/roles/{role}`, `GET|POST /organizations`, `GET|PATCH /organizations/{id}`, `GET /organizations/{id}/members`. `GET /me` now also returns `roles`. `POST /auth/register` accepts optional `intent: "freelancer" | "client"`. Errors: `FEATURE_DISABLED` (403, client side off), `CLIENT_ROLE_REQUIRED`, `ROLE_NOT_ALLOWED`, `ROLE_SUSPENDED`, `LAST_PUBLIC_ROLE`, `INVALID_ORGANIZATION` (422, `error.details[0]` = field → message), `ORGANIZATION_LIMIT`, `RATE_LIMITED` (429 + `Retry-After`). Non-members always get 404.

## New Edge endpoints this batch
`POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `POST /auth/password/change`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `GET /auth/mfa/status`, `POST /auth/mfa/setup|enable|disable|recovery-codes/rotate`, `POST /discovery/refresh`, `GET /background-jobs`. Request fields, limits, status codes and messages follow `backend/app/main.py`.

Header contract: `X-Session-Mode: cookie` (opt into cookie sessions on token-issuing routes), `X-CSRF-Token` (required with cookie sessions on POST/PUT/PATCH/DELETE).
