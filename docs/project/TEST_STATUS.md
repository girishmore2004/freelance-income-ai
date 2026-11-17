# Test Status

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
