# Test Status

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
