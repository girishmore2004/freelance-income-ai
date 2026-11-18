# Project Status — Freelance Income AI

As of 2026-11-18: Edge API **5.70.0** (branch `cloudflare-edge-api-phase1`), frontend **5.70.0** (`main`), migration head **`0066_business_coach_partial`**. Every batch passed GitHub CI (Python, Alembic on PostgreSQL, frontend build, Playwright in bearer and cookie modes, Edge typecheck/vitest/dry-run) before the next one started. Cloudflare deploys each push automatically.

## Where the project really stands
- **Marketplace loop: built and CI-verified, switched OFF.** Post a brief (AI Brief Builder) → screening and moderation → matching with explanations → invitations → proposals → comparison → offer → two-party contract (versions, change orders) → funding (test mode) → delivery workspace (submissions, revisions, acceptance checklist, messages, activity log) → approval releases funds → completion → two-way reviews; cancellation by agreement with refunds; disputes decided by staff. All behind `marketplace.client_side` (OFF).
- **Not yet confirmed in production:** migrations 0051–0066 have not been confirmed as run on Neon. Until they are, the client-side features must stay OFF.
- **Money loop: works in test mode only.** Provider-agnostic funding, release, refunds, payouts, test invoices, all as balanced double-entry ledger entries (reconciled on PostgreSQL). Live money stays BLOCKED on D-1/D-2: `payments.live` is OFF, locked in the admin UI and refused in code.
- **Business model:** plans and AI credits work as data (free plan = today's limits); fees (D-5) and paid prices (D-14) are not set; buying is BLOCKED with live payments.
- **Agents:** 28 catalogue agents in a governed registry with honest status — live: F2, F4, C1, C2, C3, C5, C6; partly: F1, F9, P1, P8; blocked: F10, P2, P6; the rest planned. Per-agent kill switch enforced by the AI governor. Dispute and suspension decisions are human-only (Master Plan 3.5).
- **Trust/admin:** reports, moderation queue, append-only moderation log, overview, flags, disputes with evidence packs, account suspension with appeals, in-app notifications, team invitations and roles, contract files (R2; needs the bucket). Not built: policy documents and account deletion (legal, D-1).
- **Legacy pages (K-01):** `/security`, `/workspace`, `/agent` and `/coach` work on Edge (the last three ported and extended with marketplace data, including the F11 Business Coach). Eight Python-only tools show a clear notice with working alternatives until decision D-11.

- **Experience (PRODUCT_EXPERIENCE_SPEC, plan in UI_EXPERIENCE_PLAN.md):** U1–U4 done — design system, workspace shell, public homepage, public project and freelancer browsing, one Find work page for native and external opportunities, dashboard answering the five questions. U5–U6 planned (posting wizard and Proposal Studio, analytics and admin user management).

## Repository and architecture map

| Component | Repo / path | Runtime | Role today |
|---|---|---|---|
| Frontend (Next.js 16, OpenNext) | `freelance-income-ai/frontend` (`main`) | Worker `freelance-income-ai` | UI; same-origin proxy to the Edge API |
| Edge API (TypeScript) | `backend/edge-api` (`cloudflare-edge-api-phase1`) | Worker `freelance-income-ai-api-edge` | The only live backend: auth, identity, listings, matching, hiring, contracts, delivery, reviews, payments (test mode), ledger/fees, plans, agents, trust/admin, disputes, suspensions, notifications, public pricing; queue consumer and 6-hourly cron |
| Python API (FastAPI) | `backend/app` | not deployed | Reference implementation and schema models |
| Migrations | `backend/alembic` | GitHub Action "Stage 3C Neon migrations" | Schema authority (head `0066_business_coach_partial`) |
| Database | Neon PostgreSQL via Hyperdrive | — | Shared |

## What only you can do
1. **Neon:** create a backup branch, then run **Actions → "Stage 3C Neon migrations"** (expects `0066_business_coach_partial`). It applies 0051–0066 in one run.
2. **Staff roles:** give yourself `admin` (and `finance`, `moderator`) with the SQL in DEPLOYMENT_RUNBOOK.md (Phase 4 step 3).
3. **Try it on staging:** `/admin` → Feature flags → turn **marketplace.client_side** on; walk the journey in the runbook; turn it off again if anything looks wrong.
4. **Decisions** (BUSINESS_DECISIONS.md): D-1 legal entity/tax, D-2 payment provider, D-3/D-4 payment mode and loss rules, D-5 fees, D-6 categories, D-13 AI provider policy, D-14 plan prices, D-15 email sender domain, D-16 contact-details policy; confirm the provisional D-17 to D-19.
5. **Cloudflare:** create the R2 bucket `freelance-income-ai-files` (runbook "Files"); keep `RESEND_*` as runtime secrets; delete the old `freelance-income-ai-api` Worker when convenient.

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
