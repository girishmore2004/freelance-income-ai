# Upgrade v5.35.0 → v5.36.0

1. Back up the production database and source repository.
2. Replace the application source with the v5.36.0 release while retaining deployment environment variables.
3. No Alembic migration is required for this release.
4. Deploy the FastAPI backend and Next.js frontend using the existing Render/Vercel configuration.
5. Sign in and open Business Intelligence; review Project Delivery Health and Change-Control Readiness.

The endpoint is user-scoped and read-only. Health labels are internal operational signals, not client satisfaction guarantees. Change-control summaries do not approve scope, amend contracts or send messages.
