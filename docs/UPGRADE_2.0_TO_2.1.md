# Upgrade from 2.0 to 2.1

1. Back up PostgreSQL and the current deployment.
2. Replace the application files with the v2.1 release while retaining deployment secrets.
3. Install backend dependencies from `backend/requirements.txt`.
4. Run `cd backend && alembic upgrade head`.
5. Install frontend dependencies with `cd frontend && npm ci`.
6. Run `npm run typecheck` and `npm run build` in `frontend`.
7. Deploy the backend and frontend using the existing Render/Vercel configuration.
8. Sign in and open `/coach`, or use `POST /api/v1/coach/ask` with a bearer token.

Migration `0018_grounded_business_coach` creates the coach history table. Keep the v2.0 database backup until the new deployment is verified.
