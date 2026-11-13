# Upgrade 2.3 to 2.4

1. Back up the current repository and PostgreSQL database.
2. Merge the v2.4 files into the existing repository; retain `.env`, provider credentials and deployment secrets.
3. Install backend dependencies from `backend/requirements.txt`. LangGraph is already part of the pinned requirements.
4. Run `cd backend && alembic upgrade head`.
5. Ensure `REDIS_URL` is configured and the existing RQ worker is running: `rq worker freelance-income-ai`.
6. Install frontend dependencies with `cd frontend && npm ci`; run `npm run typecheck` and `npm run build`.
7. Deploy the API and frontend using the existing Render/Vercel setup.
8. Sign in and open `/agent-workflows`. Start a business review and inspect the execution trace and checkpoints.

If a run fails, inspect its detail and error message. Retry is limited to three total attempts. A worker stuck in `running` for over 20 minutes can be recovered through the same retry action. Do not reset or delete workflow checkpoint rows while a run is active.
