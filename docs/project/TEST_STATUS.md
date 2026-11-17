# Test Status

## Phase 5 batch 1 — 2026-11-17 IST (release 5.55.0)
- Edge API: **221 passed, 0 failed** (new `plans.test.ts` 7: plan limits from the user's plan, the free plan or the Worker defaults when plan tables are missing; one credit per call beyond the monthly limit, never beyond the daily limit; missing credit table = 0; plan validation; admin-only routes; idempotent credit grants; the free plan cannot be retired). Existing `ai-governor.test.ts` unchanged and passing. Bundle 478 KB.
- PostgreSQL 16 with the 0057 DDL: free plan limits 20/300 apply by default; admin creates a draft plan (invalid 422, duplicate 409), cannot grant a draft (422), activates it, cannot retire `free` (409), unknown email 404, grants the plan (email match is case-insensitive) → limits switch to 2/day, 3/month → real governor calls: ok, ok, daily limit, daily limit → credit grant (repeat with the same grant id writes nothing) → ok, ok + 1 credit spent, monthly limit, monthly limit → `/me/plan` shows plan, usage and 0 credits left.
- Frontend: typecheck 0 errors (Account plan card, admin plan tools on `/finance`, new `e2e/plans.spec.ts`; finance e2e label made exact because a "Plan name" field now exists).
- Python: `tests/test_plans_credits_v557.py` (3 tests) compiled; runs in CI.

## Phase 4 batch 1 — GitHub CI (verified)
Green on the first push; the CI migration job ran 0056 (with the trigger SQL) on real PostgreSQL. `main` @ 6eb6041: pytest 539 passed; Playwright 29 passed / 2 skipped (bearer), 30 passed / 1 skipped (cookie). Edge API CI 214/214.

## Phase 4 batch 1 — 2026-11-17 IST (release 5.54.0)
- Edge API: **214 passed, 0 failed** (new `ledger.test.ts` 9: entry validation incl. live refusal, natural balances, one-transaction posting and idempotent repeats, half-up rounding, minimum-fee top-up, schedule bounds, staff-only routes, approval by admin only with retirement of the previous schedule). Typecheck clean.
- PostgreSQL 16 with the 0056 DDL and its trigger SQL (extracted verbatim from the migration): balanced sandbox entry posted; repeated idempotency key returned the same entry with nothing written; live / unbalanced / fractional entries refused by code; an unbalanced entry inserted directly with SQL **rejected by the database at commit**; UPDATE and DELETE on ledger rows **rejected by the database**; reversal entry posted; trial balance totals equal; finance API: non-staff 404, quote 409 until a schedule is approved, invalid schedule 422, finance cannot approve (403), admin approves, re-approve 409, quotes ₹10,000 → client ₹350 / freelancer ₹250, ₹500 → minimum ₹50 topped up on the client side.
- Frontend: typecheck 0 errors (fee estimate on contracts, `/finance` staff page, new `e2e/finance.spec.ts` with 2 journeys, `/finance` added to sign-in guard checks).
- Python: `tests/test_ledger_foundation_v556.py` (3 tests) compiled; runs in CI (the CI migration check runs 0056 on real PostgreSQL, including the triggers).

## Phase 3 batch 3 — GitHub CI (verified)
Green on the first push. `main` @ 1a525aa: pytest 536 passed; Playwright 26 passed / 2 skipped (bearer), 27 passed / 1 skipped (cookie). Edge API CI 205/205.

## Phase 3 batch 3 — 2026-11-17 IST (release 5.53.0)
- Edge API: **205 passed, 0 failed** (new `review.test.ts` 6: pending-change detection and per-party actions, delivered-milestone locks, reveal rule, rating/comment validation, review routes incl. window, owner/admin, duplicates, hidden reviews; `matching.test.ts` covers the rating on cards). Typecheck clean; bundle 458 KB.
- PostgreSQL 16 (0055 DDL + backfill), real handlers end to end: activation sets `agreed_version` → delivery → change order that alters a delivered milestone refused (422) → valid change order (adds a milestone) leaves the workspace on the agreed 2 milestones while pending → reject → accept refused (nothing pending) → new change order → **version numbering bug found and fixed** (after a rejection the next version reused number 2 and hit the unique constraint; versions now continue from the highest number) → both accept → workspace shows 3 milestones → all approved → completed → reviews: invalid rating 422, client review hidden from the freelancer, duplicate 409, freelancer review reveals both → freelancer card shows ★ 5 (1) only after reveal.
- Frontend: typecheck 0 errors (change-order banner/actions, reviews panel, ratings on cards, new e2e review journey).
- Python: `tests/test_change_orders_reviews_v555.py` (2 tests) compiled; runs in CI.

## Phase 3 batch 2 — GitHub CI (verified)
First run: 1 Playwright failure — the offer-acceptance test's catch-all mock returned `[]` for the new workspace call and the page crashed; fixed by validating the reply shape in the component (and mocking the call). Re-run on `main` @ 040ca84: pytest 534 passed; Playwright 25 passed / 2 skipped (bearer), 26 passed / 1 skipped (cookie). Edge API CI 199/199.

## Phase 3 batch 2 — 2026-11-17 IST (release 5.52.0)
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **199 passed, 0 failed** (new `delivery.test.ts` 9: milestone state derivation, https-only links, party-only workspace, freelancer-only delivery, one open delivery per milestone, revision limit and required reason, owner/admin review, completion only when all milestones approved, message screening/closing; `hiring.test.ts` now also checks the activity-log insert). Typecheck clean; bundle 447 KB.
- PostgreSQL 16 with the 0054 DDL, real handlers end to end: offer → message during negotiation → delivery refused before activation → accept → stranger 404 → contact-detail message 422 → client cannot deliver → http link 422 → deliver → second delivery 409 → missing milestone 404 → revision without reason 422 → revision → redeliver → revision over the 1 agreed round 409 → approve → nothing to review 409 → second milestone → approve → contract **completed**; workspace shows ₹15,000/₹15,000 approved and the full activity trail (offer.sent → terms.accepted → contract.activated → … → contract.completed); messages closed after completion.
- Frontend: typecheck 0 errors (new workspace component, 5 e2e specs incl. a new deliver-and-approve journey); `npm run test:unit` 11/11.
- Python: `tests/test_delivery_workspace_v554.py` (3 tests) compiled; runs in CI.

## Phase 3 batch 1 — GitHub CI (verified)
Edge API CI 190/190; `main` @ c404d6d: pytest 531 passed; Playwright 24 passed / 2 skipped (bearer), 25 passed / 1 skipped (cookie). Green on the first push.

## Phase 3 batch 1 — 2026-11-17 IST (release 5.51.0)
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **190 passed, 0 failed** (new `hiring.test.ts` 17: proposal and terms validation, server-computed totals, screening, party actions, route isolation from the existing `/proposals` routes, invite-only/member/closed checks, owner/admin rules, one-transaction offers, activation only on matching versions, stale/double acceptance, counter-proposals). Typecheck clean; bundle builds (432 KB).
- PostgreSQL 16 with the 0053 DDL, real handlers end to end: proposals (role, validation, screening, duplicate, edit) → client list (outsider 404) → decline/shortlist → invalid offer 422 → offer v1 → duplicate offer 409 → other freelancer 404 → counter-offer v2 (total recomputed) → double accept 409 → stale accept 409 → client accepts v2 → active, proposal hired, listing hiring → withdraw refused → deleting a user with a contract is blocked by RESTRICT.
- Frontend: typecheck 0 errors (incl. new `/contracts` page, terms form, proposal and offer panels, 5 e2e specs); `npm run test:unit` 11/11 (new exact-amount formatter test). Playwright runs in CI (new `e2e/hiring.spec.ts`, 3 journeys; `/contracts` added to the sign-in guard checks).
- Python: `tests/test_proposals_contracts_v553.py` (4 tests) compiled; runs in CI.

## Phase 2 batch 2 — 2026-11-17 IST (release 5.50.0)
- **GitHub CI (verified):** Edge API CI 173/173 (vitest, 14 files); Backend tests + Full CI on `main` @ 9bbacbe: pytest 527 passed; Playwright 20 passed / 2 skipped (bearer) and 21 passed / 1 skipped (cookie). First push failed on two real defects, both fixed: revision id longer than `alembic_version`'s 32 characters, and the opt-in checkbox only changing after the API reply.
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **173 passed, 0 failed** (new `matching.test.ts` 22; `listings.test.ts` now 25 with closing-date tests). Typecheck clean (TS-6-only `mfa-service.ts` messages excluded, as before). Worker bundle builds (402 KB).
- PostgreSQL 16 with the 0052 DDL: the **real route handlers** were run end to end with the real driver: create invite-only listing with closing date → publish → matches (hidden freelancer excluded, newcomer flagged) → invite-only listing hidden before invitation, visible to the invitee only → duplicate invite 409 → hidden freelancer 404 → other user's invitation 404 → accept → second answer 409 → withdraw → re-invite → saved-freelancer upsert → outsider 404 → opt-in/out → closing-date-only edit keeps version 1 → expiry marks the listing expired. `= ANY(text[])` parameter verified.
- Frontend: typecheck 0 errors (pages, components, all 4 e2e specs incl. 2 new Playwright tests); `npm run test:unit` 10/10. Playwright runs in CI.
- Python: `tests/test_invitations_saved_v552.py` (5 tests) compiled; runs in CI.

## Phase 2 batch 1 — 2026-11-17 IST (release 5.49.0)
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **149 passed, 0 failed** (new `listings.test.ts` 23: validation, lifecycle, screening, public projection, Brief Builder guard/quota/fallback, routes incl. non-member 404s, owner-only transitions, version conflicts, re-screening). Typecheck clean; bundle builds.
- PostgreSQL 16: 0051 DDL; marketplace query with bound parameters (filters, search, keyset paging; excludes draft/private/expired/closed-org); FOR UPDATE + new version; unique version, budget range, status and category FK rejections.
- Frontend: typecheck 0 errors (incl. new pages and 4 e2e specs); `npm run test:unit` 10/10 (new money-conversion tests); render smoke of `/client/projects` and `/projects`. Playwright runs in CI.
- Python: `tests/test_project_listings_v551.py` compiled (runs in CI); category seed checked directly (8 categories, only website_development enabled).


## Full CI run #370 — root cause found (2026-11-17 20:05 IST)
The recurring "login failure…" e2e failure was in the **cookie-mode** Playwright pass (15 tests: 13 passed, 1 skipped, 1 failed). In cookie mode the page calls `GET /api/v1/me` to detect a session; the test's catch-all mock answered 200, so the page treated the visitor as signed in and never showed the login form (in `next dev` the form appeared, then vanished — the earlier "detached" message). Earlier explanations (parallel compilation, dev-server reloads) were wrong. Fix: the mock returns 401 for `/me` until a login succeeds, like the real API. The production-build Playwright setup is kept (it tests what ships).


## Full CI run #357 — 2026-11-17 19:50 IST
`frontend-e2e`: 13 passed, 1 skipped, 1 failed — the same "login failure" test (input repeatedly detached before typing), even with one worker, so the parallel-compile explanation was incomplete. Change: CI Playwright now runs against a production build instead of `next dev`. Verified in Next.js source that `next start` with `output: 'standalone'` only warns. Not runnable here (no npm registry); confirm on the next CI run.


## Phase 1 batch 1 — 2026-11-17 IST (release 5.48.0)
- Edge API with real `postgres` 3.4.9 + `bcryptjs`: **126 passed, 0 failed** (new `identity.test.ts` 19: roles, organisation validation, flag gating, cross-account 404s, owner-only edits, billing visibility, transactions, rate limiting). Typecheck clean (TS-6-only `mfa-service.ts` messages excluded, as before).
- PostgreSQL 16: migration 0050 DDL, idempotent backfill, check constraints, role toggle, membership lookups (outsider gets 0 rows), account deletion not blocked (`SET NULL`).
- Frontend: typecheck 0 errors (pages, lib, all three e2e specs); `npm run test:unit` 6/6; server-render smoke test of `/account` and `/`. Playwright not run here (CI runs it in bearer and cookie modes).
- Python: `tests/test_identity_roles_v550.py` compiled, runs in CI.


## Batch 2 CI follow-up — 2026-11-17 19:15 IST
Full CI run #329: (1) `test:unit` failed because the test file was uploaded as `api-clients.test.mts`; renamed. (2) Playwright: 10 passed, 1 skipped, 1 failed ("login failure…": login input repeatedly detached = dev-server reload while other pages compiled in parallel; the identical success-login test passed). Fix: one Playwright worker in CI. Re-verified on the live branch files: `npm run test:unit` 6/6, frontend typecheck 0 errors.

## Phase 0 batch 2 — 2026-11-17 19:xx IST
- Edge API (`cloudflare-edge-api-phase1` @ batch-2 commit), real `postgres` 3.4.9 + `bcryptjs` 3.0.2: **107 passed, 0 failed** (11 files; new `ai-guard.test.ts` 23). Bundle builds (333 KB) with the guard; eval JSON not bundled.
- Frontend: strict typecheck of all pages, `lib/`, both e2e specs and `playwright.config.ts` with real React 18 + Playwright 1.63 types: 0 errors (baseline 0). `npm run test:unit`: 6/6. `next build` and Playwright were not run here (npm registry unreachable) — CI runs both, including a second Playwright pass with `E2E_AUTH_MODE=cookie`.
- Workers Build #8f8b52e3 (batch 1) ran the real vitest: 84/84.


## Update 2026-11-17 18:30 — Edge API CI failure fixed
GitHub "Edge API CI" run #28 failed typecheck with 10 errors. Reproduced exactly with the real `postgres` 3.4.9 types (installed from GitHub) and fixed:
- `src/lib/job-routes.ts` had been uploaded as `job_routes.ts` (renamed).
- postgres ≥ 3.4.8: `TransactionSql` is no longer a subtype of `Sql`; query helpers now accept `Queryable = Sql | TransactionSql`.
After the fix, with real `postgres` 3.4.9 and real `bcryptjs` 3.0.2: typecheck clean (except TS 6-only `mfa-service.ts` messages your CI's TS 5.9 does not report), **84 passed, 0 failed** (the 4 password tests now run), Worker bundle builds with `fetch`, `scheduled`, `queue`.


Run on 2026-11-17 in an offline build container (no package downloads). Results are reported exactly; nothing below is a CI or production result.

## Edge API (`backend/edge-api`)
Runner: the repository's own `*.test.ts` files executed with `tsx` and a local stand-in for the vitest API (vitest, `postgres`, `bcryptjs` and `@cloudflare/workers-types` could not be installed).

| Suite | Result |
|---|---|
| account-routes (new) | 16 passed |
| ai-governor (new) | 11 passed |
| auth-context (new) | 9 passed |
| jobs (new) | 11 passed |
| token-crypto (new) | 11 passed |
| apply-agent | 4 passed |
| discovery-agent | 7 passed |
| project-sources | 4 passed |
| scoring | 5 passed |
| password-service | 2 passed, **4 not runnable** (needs real `bcryptjs`; environment, not a code defect) |
| **Total** | **80 passed, 4 not runnable** (baseline before this batch: 22 passed + same 4) |

Typecheck (`tsc --noEmit`, TypeScript 6 with stub types): 0 new errors versus baseline; 11 pre-existing harness-only errors (bcryptjs stub typing, TS 6 DOM `BufferSource`). Bundle (`esbuild`): builds, 218 KB, exports `fetch`, `scheduled`, `queue`, contains no test code.

## Database (real PostgreSQL 16.15)
- 0047 DDL, fresh and hand-made-table paths, then every Edge SQL statement shape for the three tables: pass; duplicate live send and duplicate message rejected; failed send allowed.
- Job queue: idempotent enqueue, two consumers racing (one claims), duplicate delivery after success (not re-run), stale claim (reclaimed after 15 min), fresh claim (not reclaimed): pass.
- AI usage aggregation: per-user day/month counts across services and global daily cost: pass.
- Alembic itself was **not** executed (SQLAlchemy/Alembic unavailable offline).

## Python backend
- New/changed tests: `tests/test_edge_apply_tables_v546.py`, `tests/test_system_diagnostics_v542.py`. Byte-compiled only; **not run** (FastAPI/SQLAlchemy unavailable). The migration-head logic was executed directly: single head `0049_feature_flags_ai_cost`.
- Historical baseline (Progress Report): 495 passed, 12 skipped.

## Frontend
New files (`app/api/v1/[...path]/route.ts`, `lib/api-client.ts`) pass an isolated strict typecheck. `next build`, ESLint and Playwright were **not run**.

## Must run in CI before deploy
`Full CI` (pytest + Alembic on pgvector + frontend build + Playwright) and the new `Edge API CI` (clean npm install, typecheck, vitest, wrangler dry-run).
