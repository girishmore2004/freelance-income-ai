# Project Status — Freelance Income AI

As of 2026-11-17, release 5.46.0 (Phase 0 batch 1 written and tested locally; **not deployed**).

## Where the project really stands
- Overall plan coverage remains about **35%** (Playbook scoreboard). This batch closes stabilisation defects; it adds no marketplace features yet.
- Production runs **only** on Cloudflare: the frontend Worker plus the Edge API Worker, against Neon. The Python FastAPI app is **not deployed** (README: "reference spec for porting"); its Alembic migrations are still the only schema authority.
- Consequence: of about 153 API route references across the 13 frontend pages, about 53 resolve on the Edge API. Twelve pages are mostly non-functional in production. See API_CONTRACT_STATUS.md.

## Repository and architecture map

| Component | Repo / path | Runtime | Role today |
|---|---|---|---|
| Frontend (Next.js 16, OpenNext) | `freelance-income-ai/frontend` | Cloudflare Worker `freelance-income-ai` | UI; home page uses Edge routes, 12 pages call Python routes |
| Edge API (TypeScript) | `freelance-income-ai-api-edge/backend/edge-api` | Worker `freelance-income-ai-api-edge` | Live API: auth, profile, opportunities, proposals, approvals, apply/reply agent, Gmail; now also the queue consumer |
| Python API (FastAPI, LangGraph) | `freelance-income-ai/backend/app` | **not deployed** | Reference implementation, 246 routes, schema models |
| Migrations | `freelance-income-ai/backend/alembic` | GitHub Action "Stage 3C Neon migrations" | Schema authority (head `0049_feature_flags_ai_cost`) |
| Queue consumer (old) | `backend/queue-consumer` | Worker `freelance-income-ai-consumer` | Health-check only; to be detached (runbook step 5) |
| Python Worker adapter | `backend/cloudflare` | Worker `freelance-income-ai-api` | Health/queue smoke tests only |
| Database | Neon PostgreSQL via Hyperdrive `1875e95a…` | — | Shared by all |

## Conflicts between documents and code

| # | Documents say | Code shows | Resolution |
|---|---|---|---|
| C1 | Playbook: main zip "has an older home page" | Main zip `page.tsx` is newer: it calls Edge-only routes (`/applications`, `/integrations/gmail/*`); the Edge zip's copy is older | Frontend source of truth = `freelance-income-ai` (ADR-001) |
| C2 | Master Plan 4.7 recommends hybrid with Python as system of record | Python is not hosted anywhere; production is Edge-only | Decision D-11 is open; recommendation in ARCHITECTURE_DECISIONS.md |
| C3 | Finding 2: OAuth key from `JWT_SECRET` | True for Edge only; Python already uses `OAUTH_ENCRYPTION_KEY`. Python **MFA** secrets are derived from `SECRET_KEY` (same class of issue) | Edge fixed; MFA logged as K-04 |
| C4 | Edge reported registration/MFA/reset "pending" | Partly implemented, partly unwired; token store INSERT was broken | Fixed and wired |
| C5 | Python readiness expected revision 0045 | Head was 0046 | Fixed with a tested constant |
| C6 | Finding 4 lists queue gap | Also: cron ran AI drafting inline for up to 10 users with no quota | Moved to queue + AI governor |

## Blockers (summary — full list in BUSINESS_DECISIONS.md)
- D-11 architecture option (A/B/C) — needed before more route porting.
- D-1/D-2 legal entity, payment provider — Phase 4 money movement stays disabled (`payments.live` flag OFF).
- Resend account + verified sender domain — required before turning on email verification.
- Real AI provider prices — governor defaults are placeholders.
