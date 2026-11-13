# Upgrade v5.41.0 to v5.42.0

## Changes
- Worker heartbeat with per-process Redis key and 90-second TTL.
- Protected runtime diagnostics endpoint for database, migration, Redis, RQ queue, worker and AI configuration.
- Production `/ready` now validates PostgreSQL, Redis, migration head and production configuration.
- Application default for public registration is now disabled.
- Stronger production preflight for diagnostics key, token expiry, upload limit, AI provider base URL and OAuth callback HTTPS.

## Database
No schema change and no migration. The current expected Alembic head remains `0043_archive_bundle_and_supersession`.

## Environment
- `DIAGNOSTICS_API_KEY` is optional but recommended. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- Send it only from a trusted operator terminal as `X-Diagnostics-Key`.
- Ensure `PUBLIC_REGISTRATION=false` after creating the first account.

## Rollout
1. Back up PostgreSQL.
2. Push the v5.42 source and wait for green CI.
3. Deploy API and worker from the same commit and environment.
4. Deploy frontend.
5. Check `/health` and `/ready`.
6. Call `/api/v1/system/diagnostics` with the operator key.
7. Confirm worker count is non-zero, queue counts are sensible, and Ollama model exists if using Ollama.
8. Run a harmless queued job and verify it completes.
9. No DB migration command is needed for this release.

## Limitations
OpenAI-compatible AI status is configuration-only to avoid billable probes. No credentials or external live provider accounts were available in the build environment.
