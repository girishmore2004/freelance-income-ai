# Project Status — Freelance Income AI

As of 2026-11-17: Edge API **5.59.0** (branch `cloudflare-edge-api-phase1`), frontend **5.59.0** (`main`), migration head **`0060_trust_admin`**. Every batch below passed GitHub CI (Python, Alembic on PostgreSQL, frontend build, Playwright in bearer and cookie modes, Edge typecheck/vitest/dry-run). Cloudflare deploys each push automatically.

## Where the project really stands
- **Marketplace loop without money: built and CI-verified, switched OFF.** Post a brief (with AI Brief Builder) → screening and moderation → matching with explanations → invitations → proposals → comparison → offer → two-party contract (versions, change orders) → delivery workspace (submissions, revisions within agreed rounds, acceptance checklist, messages, activity log) → completion → two-way reviews. All of it sits behind `marketplace.client_side` (OFF).
- **Not yet confirmed in production:** migrations 0051–0060 have not been confirmed as run on Neon. Until they are, the client-side features must stay OFF (the code tolerates missing plan/agent tables, but marketplace tables are required).
- **Money loop: BLOCKED.** The double-entry ledger (DB-enforced balance and append-only), fee engine and finance page exist; no payment provider, funding, payouts, refunds or invoices. `payments.live` is OFF and locked in the admin UI. Needs D-1, D-2 (and D-3, D-4, D-5).
- **Business model:** plans and AI credits work as data (free plan = today's limits); paid prices are not set (D-14); buying is BLOCKED with payments.
- **Agents:** 28 catalogue agents in a governed registry with honest status — live: F2, F4, C1, C2, C3, C5, C6; partly: F1, F9, P1, P8; blocked: F10, P2, P6; the rest planned. Per-agent kill switch enforced by the AI governor.
- **Trust/admin:** reports, moderation queue, append-only moderation log, overview, admin flag control. Not built: account suspension and appeals, disputes, policy documents (legal).
- **Legacy pages:** 12 older pages still call Python routes that are not deployed (K-01); the new marketplace pages do not depend on them.

## Repository and architecture map

| Component | Repo / path | Runtime | Role today |
|---|---|---|---|
| Frontend (Next.js 16, OpenNext) | `freelance-income-ai/frontend` (`main`) | Worker `freelance-income-ai` | UI; same-origin proxy to the Edge API |
| Edge API (TypeScript) | `backend/edge-api` (`cloudflare-edge-api-phase1`) | Worker `freelance-income-ai-api-edge` | The only live backend: auth, identity, listings, matching, hiring, contracts, delivery, reviews, ledger/fees, plans, agents, trust/admin, public pricing; queue consumer and 6-hourly cron |
| Python API (FastAPI) | `backend/app` | not deployed | Reference implementation and schema models |
| Migrations | `backend/alembic` | GitHub Action "Stage 3C Neon migrations" | Schema authority (head `0060_trust_admin`) |
| Database | Neon PostgreSQL via Hyperdrive | — | Shared |

## What only you can do
1. **Neon:** create a backup branch, then run **Actions → "Stage 3C Neon migrations"** (expects `0060_trust_admin`). It applies 0051–0060 in one run.
2. **Staff roles:** give yourself `admin` (and `finance`, `moderator`) with the SQL in DEPLOYMENT_RUNBOOK.md (Phase 4 step 3).
3. **Try it on staging:** `/admin` → Feature flags → turn **marketplace.client_side** on; walk the journey in the runbook; turn it off again if anything looks wrong.
4. **Decisions** (BUSINESS_DECISIONS.md): D-1 legal entity/tax, D-2 payment provider, D-3/D-4 payment mode and loss rules, D-5 fees, D-6 categories, D-13 AI provider policy, D-14 plan prices, D-15 email sender domain, D-16 contact-details policy.
5. **Cloudflare:** keep `RESEND_*` as runtime secrets; delete the old `freelance-income-ai-api` Worker when convenient.

## Conflicts between documents and code

| # | Documents say | Code shows | Resolution |
|---|---|---|---|
| C1 | Playbook: main zip "has an older home page" | Main zip `page.tsx` is newer: it calls Edge-only routes (`/applications`, `/integrations/gmail/*`); the Edge zip's copy is older | Frontend source of truth = `freelance-income-ai` (ADR-001) |
| C2 | Master Plan 4.7 recommends hybrid with Python as system of record | Python is not hosted anywhere; production is Edge-only | Decision D-11 is open; recommendation in ARCHITECTURE_DECISIONS.md |
| C3 | Finding 2: OAuth key from `JWT_SECRET` | True for Edge only; Python already uses `OAUTH_ENCRYPTION_KEY`. Python **MFA** secrets are derived from `SECRET_KEY` (same class of issue) | Edge fixed; MFA logged as K-04 |
| C4 | Edge reported registration/MFA/reset "pending" | Partly implemented, partly unwired; token store INSERT was broken | Fixed and wired |
| C5 | Python readiness expected revision 0045 | Head was 0046 | Fixed with a tested constant |
| C7 | Master Plan text: "27 agents" | Its catalogue tables list 28 (F1–F12, C1–C7, P1–P9) | All 28 recorded in the registry (migration 0058) |
| C6 | Finding 4 lists queue gap | Also: cron ran AI drafting inline for up to 10 users with no quota | Moved to queue + AI governor |

## Blockers (summary — full list in BUSINESS_DECISIONS.md)
- D-11 architecture option (A/B/C) — needed before more route porting.
- D-1/D-2 legal entity, payment provider — Phase 4 money movement stays disabled (`payments.live` flag OFF).
- Resend account + verified sender domain — required before turning on email verification.
- Real AI provider prices — governor defaults are placeholders.
