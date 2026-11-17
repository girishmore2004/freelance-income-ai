# Implementation Ledger

Last verified checkpoint: **2026-11-17, Phase 0 batch 1** (release 5.46.0).

**Deployment state 2026-11-17 18:34 IST (build #8f8b52e3, branch `cloudflare-edge-api-phase1` @ 4b683a1):** Workers Build ran `npm run check` — vitest 84/84 passed, typecheck passed. `wrangler deploy` uploaded the Worker (fetch + 6-hourly cron are live, v5.46.0) but **queue consumer registration failed** (code 11004: queue already has a consumer, the old `freelance-income-ai-consumer`). Neon migrations 0047–0049: not yet confirmed as run.
Status values: DONE (implemented + tested here) · PARTIAL · BLOCKED · NOT STARTED.
"Tested here" means the tests listed ran in the build environment described in TEST_STATUS.md; deployment is never claimed.

| Phase | Feature | Status | Repo | Files | Tests | Deployment | Next action |
|---|---|---|---|---|---|---|---|
| 0.1 | Migration for `integrations`, `applications`, `application_messages` | DONE | fia | `backend/alembic/versions/0047_edge_apply_tables.py`, `backend/app/models.py` | DDL + every Edge statement run on PostgreSQL 16 (fresh and hand-made schemas); `tests/test_edge_apply_tables_v546.py` written, runs in CI | Not deployed | Back up Neon, run "Stage 3C Neon migrations" |
| 0.1 | One live send per proposal (DB-enforced) | DONE | fia + edge | 0047 partial unique index; `apply-routes.ts` reserve-then-send | PostgreSQL race check; unit tests | Not deployed | — |
| 0.2 | Dedicated `OAUTH_ENCRYPTION_KEY`, rotation, legacy re-encryption | DONE | edge | `lib/token-crypto.ts`, `lib/apply-agent.ts`, `src/index.ts` | `token-crypto.test.ts` 11/11 | Not deployed | Add secret, deploy, watch `oauth_token.key_status` |
| 0.2b | Python MFA key derived from `SECRET_KEY` | NOT STARTED | fia + edge | — | — | — | Needs coordinated dual-key change in both services (KNOWN_ISSUES K-04) |
| 0.3 | HttpOnly cookie sessions + CSRF (API side) | DONE | edge | `lib/auth-context.ts`, `src/index.ts`, `lib/cors.ts` | `auth-context.test.ts` 9/9 | Not deployed | — |
| 0.3 | Same-origin proxy + shared API client (frontend) | DONE (code) | fia | `frontend/app/api/v1/[...path]/route.ts`, `frontend/lib/api-client.ts`, `frontend/wrangler.jsonc` | Isolated typecheck only; frontend build not run (no network) | Not deployed | Run frontend build in CI; migrate 13 pages to `api()`; then set `NEXT_PUBLIC_AUTH_MODE=cookie` |
| 0.4 | Real queue processing (discovery refresh, reply sync) with idempotency, retries, DLQ | DONE | fia + edge | `lib/jobs.ts`, `lib/job-routes.ts`, `src/index.ts`, `wrangler.jsonc`, `0048_queue_job_reliability.py` | `jobs.test.ts` 11/11; claim/race/stale/duplicate SQL verified on PostgreSQL | Not deployed | Detach old consumer, deploy (runbook step 5) |
| 0.5 | Edge auth parity: verify email, resend, reset, password change, sessions, MFA setup/enable/disable/rotate/status | DONE | edge | `lib/account-routes.ts`, `lib/account-mailer.ts`, `lib/account-token-store.ts`, `lib/register-route.ts` | `account-routes.test.ts` 16/16 | Not deployed | Configure Resend, then enable `REQUIRE_EMAIL_VERIFICATION` |
| 0.5 | Route-family ownership map | PARTIAL | fia | `docs/project/API_CONTRACT_STATUS.md` | — | — | Founder decision D-11 |
| 0.3 | 13 frontend pages moved to the shared client (`useSessionToken`, `authFetch`); no page reads/writes `localStorage` | DONE (code) | fia | `frontend/lib/api-client.ts`, all 13 `frontend/app/**/page.tsx` | Strict typecheck with real React 18 types: 0 errors; `lib/api-client.test.mts` 6/6 (Node test runner); `e2e/cookie-session.spec.ts` typechecked, runs in CI | Not deployed | Merge; confirm Full CI (both Playwright passes) green; then set `NEXT_PUBLIC_AUTH_MODE=cookie` (runbook) |
| 0.10 | Prompt-injection fencing + deterministic output review + labelled regression set | DONE | edge | `lib/ai-guard.ts`, `lib/ai-guard.test.ts`, `lib/ai-eval/guard-cases.json`, `core-routes.ts`, `apply-agent.ts` | 23/23; set thresholds met (all 11 attacks blocked, 0/6 false positives) | Not deployed | Add cases from `ai.output_blocked` logs; live-model eval needs D-13 |
| 0.6 | `@cloudflare/workers-types` pin + Edge CI | PARTIAL | edge | `backend/edge-api/package.json`, `.github/workflows/edge-api-ci.yml` | Clean `npm install` cannot run offline | — | Push; confirm "Edge API CI" passes |
| 0.7 | Docs match code | PARTIAL | fia | `docs/project/*` | — | — | Rewrite README + `docs/DEPLOYMENT.md` after D-11 |
| 0.8 | Feature flags + kill switch | DONE | fia + edge | `0049_feature_flags_ai_cost.py`, `lib/flags.ts` | `ai-governor.test.ts` (flag cases) | Not deployed | Admin UI in Phase 7 |
| 0.9 | Observability alerts (queue age, DLQ, AI budget, OAuth key) | PARTIAL | edge | structured `alert:true` log events | unit-tested emitters | Not configured | Create Workers Observability alerts (runbook step 7) |
| 0.x | Global AI budget + Edge per-user quotas | DONE | fia + edge | `lib/ai-governor.ts`, `core-routes.ts`, `apply-agent.ts`, 0049 | `ai-governor.test.ts` 11/11; usage SQL verified on PostgreSQL | Not deployed | Set real prices from provider page |
| 0.x | Python readiness pinned to old revision 0045 | DONE | fia | `backend/app/main.py`, `tests/test_system_diagnostics_v542.py` | Head-check logic run locally; pytest in CI | — | — |
| 0.x | Edge placeholder empty lists → honest 501 | DONE | edge | `lib/core-routes.ts` | typecheck | Not deployed | — |
| 0.x | Broken `issueAccountActionToken` INSERT (8 values / 7 columns) | DONE | edge | `lib/account-token-store.ts` | covered by route tests | — | — |
| 0.x | Dead duplicates removed (`account-mail.ts` = copy of token store; unused `account-tokens.ts`) | DONE | edge | deleted | typecheck | — | Consolidate `mfa.ts`/`mfa-service.ts` (K-06) |
| 1 | Foundation remainder (roles, orgs, rate limits on Edge, OpenAPI) | NOT STARTED | — | — | — | — | After D-11 |
| 2–8 | Client marketplace, shared delivery, payments, business model, agents, trust, launch | NOT STARTED | — | — | — | — | Phase 1 first; payments BLOCKED on D-1/D-2 |

## Next exact step
Phase 0 batch 3 / Phase 1 start, after founder decision D-11 (architecture): OpenAPI contract for Edge-owned route families; Edge rate limiting (K-03); `package-lock.json` for the Edge API (K-11); MFA key separation (K-04); then Phase 1 roles (freelancer/client) and organisations.
