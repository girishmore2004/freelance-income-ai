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
| Change orders after activation, payments, payouts, reviews, disputes, admin | — | Not built (Phases 3–7) |

## Phase 2 endpoints (Edge 5.49.0, behind `marketplace.client_side`)
`GET /project-categories`; `POST /organizations/{org}/brief-assistant {category_slug, notes}` → `{draft, source: "model"|"template", note?}` (not stored); `GET|POST /organizations/{org}/listings`; `GET /listings/{id}` (with version history); `PUT /listings/{id} {base_version, ...brief}` → new version (409 `VERSION_CONFLICT` / `NOT_EDITABLE`); `POST /listings/{id}/transition {action: submit|pause|resume|close|cancel}` (owner/admin; 409 `INVALID_TRANSITION`; 422 `INCOMPLETE_BRIEF` with `details[0].gaps`); `GET /marketplace/listings?category=&q=&before=` → `{items, next_before}`; `GET /marketplace/listings/{id}`. Money fields are integer minor units (`budget_min_minor`, `budget_max_minor`). Marketplace items never include organisation ids, billing data, ownership notes or assumptions; confidential briefs show "Confidential client" and no description. Listings accept an optional `closes_at` (YYYY-MM-DD, tomorrow to 180 days; 422 field error `closes_at`); a closing-date-only edit does not create a new version.

**Matching and invitations (5.50.0, Edge only, behind `marketplace.client_side`):** `GET|PUT /me/marketplace-profile {visible}` (opt-in; 403 `FREELANCER_ROLE_REQUIRED`, 422 `PROFILE_INCOMPLETE`); `GET /me/invitations`; `POST /me/invitations/{id}/respond {response: accept|decline}` (409 `ALREADY_ANSWERED` / `LISTING_CLOSED`); `GET /listings/{id}/matches` → `{candidates_considered, method: "deterministic", matches[{freelancer, score, breakdown, reasons, missing_skills, newcomer_slot, invitation_status, saved}]}`; `GET|POST /listings/{id}/invitations {freelancer_user_id, message, match_score?}` (owner/admin; 409 `ALREADY_INVITED` / `LISTING_NOT_OPEN` / `LISTING_PRIVATE` / `LIMIT_REACHED`; 422 `MESSAGE_NOT_ALLOWED` for contact or payment details); `POST /listings/{id}/invitations/{inv}/withdraw`; `GET|POST /organizations/{org}/saved-freelancers`, `DELETE /organizations/{org}/saved-freelancers/{userId}`. Freelancer cards contain only name, headline, skills, services, hourly rate, hours, timezone and a newcomer flag.

**Proposals and contracts (5.51.0, Edge only, behind `marketplace.client_side`):** `POST /marketplace/listings/{id}/proposals {cover_letter, price_minor, estimated_days?}` (403 `FREELANCER_ROLE_REQUIRED`, 404 hidden/own listing, 409 `LISTING_NOT_OPEN` / `ALREADY_PROPOSED`, 422 `INVALID_PROPOSAL`); `GET /me/proposals`; `PUT /listing-proposals/{id}`; `POST /listing-proposals/{id}/withdraw`; `GET /listings/{id}/proposals`; `POST /listing-proposals/{id}/status {action: shortlist|decline}`; `POST /listing-proposals/{id}/offer {terms}` → contract (201). Native proposals use `/listing-proposals/…` so the existing `/proposals/…` routes for external opportunities are unchanged. `GET /contracts`; `GET /contracts/{id}` → `{status, party, terms, versions, allowed_actions, funding: {available: false, message}}`; `POST /contracts/{id}/accept {version}` (409 `VERSION_CONFLICT` / `ALREADY_ACCEPTED` / `CONTRACT_CLOSED`); `POST /contracts/{id}/versions {base_version, terms}`; `POST /contracts/{id}/decline` (freelancer); `POST /contracts/{id}/withdraw` (client owner/admin). Terms: `{title, scope, deliverables[], milestones[{title, amount_minor, due_date?}], revision_rounds, acceptance_criteria[], ownership_terms}`; `total_minor` is computed by the server.

**Delivery workspace (5.52.0):** `GET /contracts/{id}/workspace` → `{status, party, can_manage, revision_rounds, milestones[{index, title, amount_minor, due_date, state: pending|submitted|approved|revision_requested, revisions_used, submissions[]}], approved_minor, total_minor, messages[], activity[], funding_note}`; `POST /contracts/{id}/messages {body}` (offered/active; 422 `MESSAGE_NOT_ALLOWED`); `POST /contracts/{id}/milestones/{i}/submit {note, links[]}` (freelancer, active; 409 `MILESTONE_NOT_OPEN`; 422 `INVALID_LINKS` — https only); `POST /contracts/{id}/milestones/{i}/review {decision: approve|request_revision, note}` (client owner/admin; 409 `NOTHING_TO_REVIEW` / `NO_REVISIONS_LEFT`; 422 `NOTE_REQUIRED`) → `{contract_completed}`. Approval never moves money. `GET /marketplace/listings/{id}` also returns invite-only listings to invited freelancers.

## Phase 1 endpoints (Edge 5.48.0)
`GET /me/identity`, `POST /me/roles {role}`, `DELETE /me/roles/{role}`, `GET|POST /organizations`, `GET|PATCH /organizations/{id}`, `GET /organizations/{id}/members`. `GET /me` now also returns `roles`. `POST /auth/register` accepts optional `intent: "freelancer" | "client"`. Errors: `FEATURE_DISABLED` (403, client side off), `CLIENT_ROLE_REQUIRED`, `ROLE_NOT_ALLOWED`, `ROLE_SUSPENDED`, `LAST_PUBLIC_ROLE`, `INVALID_ORGANIZATION` (422, `error.details[0]` = field → message), `ORGANIZATION_LIMIT`, `RATE_LIMITED` (429 + `Retry-After`). Non-members always get 404.

## New Edge endpoints this batch
`POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `POST /auth/password/change`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `GET /auth/mfa/status`, `POST /auth/mfa/setup|enable|disable|recovery-codes/rotate`, `POST /discovery/refresh`, `GET /background-jobs`. Request fields, limits, status codes and messages follow `backend/app/main.py`.

Header contract: `X-Session-Mode: cookie` (opt into cookie sessions on token-issuing routes), `X-CSRF-Token` (required with cookie sessions on POST/PUT/PATCH/DELETE).
