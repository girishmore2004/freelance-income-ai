# Upgrade from 2.1 to 2.2

Release 2.2 adds a read-only endpoint and frontend page. It adds no database tables or migrations.

1. Back up your repository and database as usual.
2. Merge/copy the v2.2 project files into the existing repository. Keep `.env` and deployment secrets out of Git.
3. Backend: install pinned requirements and restart the API. No Alembic migration is required.
4. Frontend: run `npm ci`, then `npm run typecheck` and `npm run build`.
5. Deploy the backend and frontend using your existing Render/Vercel settings.
6. Sign in and open `/agent`, or call `GET /api/v1/agent/action-plan` with your bearer token.

The endpoint is authenticated and tenant-scoped. It only returns recommendations; it does not execute them.
