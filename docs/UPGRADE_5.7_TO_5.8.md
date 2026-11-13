# Upgrade Freelance Income AI 5.7.0 → 5.8.0

## What changes

- Adds user-owned saved Upwork keyword searches.
- Supports 6, 12 or 24-hour recurrence, pause/resume, manual run-now and deletion.
- Adds a scheduled read-only discovery runner and a GitHub Actions workflow that checks due searches every 15 minutes.
- Reuses the v5.7.0 GraphQL, scoring, deduplication and token-refresh pipeline.
- No application submission or provider mutation is performed.

## Upgrade steps

1. Back up PostgreSQL and retain the current deployment configuration.
2. Extract v5.8.0 over the existing repository. Preserve `.git`, `.env`, uploads and deployment secrets.
3. Install the pinned backend requirements and run the focused tests/CI.
4. Apply the migration exactly once after backup: `cd backend && alembic upgrade head`.
5. Configure GitHub repository secrets: `PRODUCTION_DATABASE_URL`, `OAUTH_ENCRYPTION_KEY`, `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`, `UPWORK_REDIRECT_URI`, and `UPWORK_SCOPES`.
6. Enable both `.github/workflows/upwork-cache-retention.yml` (hourly) and `.github/workflows/upwork-saved-discovery.yml` (every 15 minutes). GitHub scheduled workflows run from the default branch; merge the workflow before relying on it. Leave the GitHub repository variable `UPWORK_CACHE_RETENTION_ENABLED` unset initially, so the scheduled runner safely skips discovery.
7. Test both workflows manually against staging. Confirm cleanup redacts stale listing content and scheduled discovery imports only through approved read-only Upwork access.
8. Only after both jobs are verified on staging, set the API environment variable `UPWORK_CACHE_RETENTION_ENABLED=true` and the GitHub repository variable `UPWORK_CACHE_RETENTION_ENABLED=true` to enable scheduled discovery.
9. Deploy API and frontend. The frontend Marketplace page includes saved-search controls.

## Important safeguards

- Upwork credentials are server-side only. Never place them in frontend variables or source control.
- Keep the existing `OAUTH_ENCRYPTION_KEY`; changing it can make existing encrypted credentials unreadable.
- If GitHub Actions cannot reach a private Render database, configure `python -m app.scheduled_discovery` as a Render Cron Job using the same environment variables instead. Do not run both schedulers concurrently.
- The scheduler performs read-only discovery only. Proposal submission remains manually controlled and disabled at the provider adapter level.
- Listing retention cleanup is a separate required job. Do not enable discovery before verifying it.

## Migration

`0029_saved_marketplace_searches` follows `0028_marketplace_credential_vault`. No earlier migration should be edited.
