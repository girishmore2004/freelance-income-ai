# Upgrade from 1.8 to 2.0

1. Back up PostgreSQL.
2. Merge or replace the project source with this complete v2.0 package while preserving your deployment environment variables and secrets outside Git.
3. Backend: install `backend/requirements.txt`, then run `cd backend && alembic upgrade head`.
4. Frontend: run `cd frontend && npm ci && npm run typecheck && npm run build`.
5. Deploy the backend and frontend using the existing Render/Vercel configuration. Set the existing API URL and CORS environment variables for your deployment.
6. Sign in and open `/workspace`; save your operating targets.
7. Verify the manual smoke checklist in `docs/RELEASE_2.0_VERIFICATION.md`.

Do not commit `.env` files, OAuth secrets, database credentials or encryption keys. Keep the same `SECRET_KEY` and token-encryption key during a normal deployment; changing encryption keys can make stored OAuth tokens unreadable. This upgrade does not require a new paid AI provider.
