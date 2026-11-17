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
| Listings, matches, invitations, offers, contracts (two-party), payments, payouts, reviews, disputes, admin | — | Not built (Phases 2–7) |

## New Edge endpoints this batch
`POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `POST /auth/password/change`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `GET /auth/mfa/status`, `POST /auth/mfa/setup|enable|disable|recovery-codes/rotate`, `POST /discovery/refresh`, `GET /background-jobs`. Request fields, limits, status codes and messages follow `backend/app/main.py`.

Header contract: `X-Session-Mode: cookie` (opt into cookie sessions on token-issuing routes), `X-CSRF-Token` (required with cookie sessions on POST/PUT/PATCH/DELETE).
