# Upgrade 3.9.0 → 4.0.0

## Scope
This is a backward-compatible application hardening release. It does not rebuild the application or change its database schema.

## Changes
- OAuth state lookup now uses `SELECT ... FOR UPDATE` on databases that support row-level locks. This serializes concurrent callbacks so a state cannot be consumed twice by concurrent requests.
- Provider identity endpoint transport errors are returned as a controlled HTTP 502 response.
- A provider account is still persisted only after a successful token exchange, sufficient consent (when scopes are returned), and verified email identity.
- New lifecycle regression tests cover expired state, replay after token-exchange failure, owner binding, encrypted credential persistence and identity lookup outage.

## Upgrade
1. Back up the repository and database.
2. Extract/merge this release over the existing repository; preserve `.git`, `.env`, and deployment configuration.
3. No Alembic migration or new environment variable is required.
4. Install backend dependencies and run `cd backend && pytest -q`.
5. Run frontend checks using the existing deployment/CI workflow.
6. Commit and push the reviewed changes.

## Safety
OAuth state is consumed before provider network calls. If a provider request fails, the user must restart the connection flow; the same callback state is intentionally not reusable. This avoids callback replay. Marketplace submissions, email sends, deliverable handoff and payments remain separately gated and are not performed by this release.
