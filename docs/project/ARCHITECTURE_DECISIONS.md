# Architecture Decisions

Each record: context, decision, consequences. "Proposed" needs founder confirmation.

## ADR-001 Source of truth per repository (accepted, 2026-11-17)
Context: both ZIPs contain a full copy of the Python backend and frontend; they differ only in the home page and in `backend/edge-api`.
Decision: `freelance-income-ai` owns the frontend, Python backend and **all Alembic migrations**. `freelance-income-ai-api-edge` owns `backend/edge-api` (and its CI). The Python/frontend copies inside the Edge repo are stale mirrors: do not edit them and do not run Neon migrations from the Edge repo.
Consequence: one migration pipeline; removing the mirrors from the Edge repo is a later clean-up.

## ADR-002 Edge API is the queue consumer (accepted)
Context: the separate consumer Worker only handled `infrastructure.health_check`; real handlers need the Edge code (discovery, Gmail, AI governor) and database access.
Decision: the Edge Worker exports `queue()` and consumes `freelance-income-ai-jobs` with the same retry/DLQ settings. Jobs are rows in the existing `background_jobs` table (extended by 0048) — no new job table.
Consequence: one codebase for producers and consumers. The old consumer must be detached before deploying (a queue has one consumer).

## ADR-003 Cookie sessions through a same-origin proxy (accepted)
Context: `*.workers.dev` is on the Public Suffix List, so cookies set by the API host are third-party for the frontend and are blocked by browsers.
Decision: the frontend Worker proxies `/api/v1/*` to the Edge Worker via a **service binding** (`EDGE_API`). Sessions use `__Host-fia_session` (HttpOnly, Secure, SameSite=Lax) with a double-submit CSRF cookie and an Origin check. Bearer tokens remain accepted until `AUTH_ALLOW_BEARER=false`.
Consequence: no custom domain needed; the Gmail OAuth redirect URI is unchanged because the proxy keeps the Edge public origin.

## ADR-004 OAuth token keys (accepted)
Decision: `OAUTH_ENCRYPTION_KEY` (≥32 bytes, base64; the Python Fernet key works) → HKDF sub-keys for AES-256-GCM tokens and HMAC OAuth state. Versioned ciphertext `v2:<kid>:…`; `OAUTH_ENCRYPTION_KEY_PREVIOUS` for rotation; legacy JWT-derived values readable and re-encrypted lazily and by the 6-hourly cron.

## ADR-005 AI calls fail closed through one governor (accepted)
Decision: every Edge model call reserves a usage row first (worst-case estimate), checks the `ai.generation` flag, per-user daily/monthly quotas counted across both services, and a global daily budget; any failure uses the existing deterministic template. LLMs never decide amounts or approvals (unchanged).

## ADR-006 Python runtime role — **Proposed, needs decision D-11**
Options (Master Plan 4.7 / Playbook 3.4): A port to Edge; B hybrid with Python as system of record; C Python primary with Edge gateway.
Facts: Python is not deployed; B and C need an always-on Python host (new monthly cost, a second runtime to secure), and LangGraph/pgvector code cannot run in Workers unchanged.
Recommendation: **A, deliberately** — keep Edge as the only runtime; keep Python as schema authority, reference spec and test oracle; port route families in the order the marketplace needs them (auth done → client/listings → proposals/offers → delivery → finance). Choose B only if you accept hosting Python (for example a small container service) to reuse LangGraph workflows quickly.
