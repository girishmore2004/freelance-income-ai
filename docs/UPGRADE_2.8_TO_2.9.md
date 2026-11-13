# Upgrade from 2.8 to 2.9

1. Back up the database and current deployment configuration.
2. Replace the application source with this release while preserving `.git` and
   deployment environment variables.
3. Install backend dependencies from `backend/requirements.txt`.
4. Run backend tests and the two offline evaluation scripts.
5. Run frontend typecheck and production build.
6. Push the reviewed changes to GitHub and deploy the same commit to Render and
   Vercel.
7. Verify `/health`, login, proposal editing, approval request/decision, mark-ready,
   workflow resume, retrieval and analytics.

No Alembic migration is introduced in 2.9. Keep `.env`, OAuth secrets and real
portfolio/client benchmark data out of Git. This release does not change any
provider credentials or automatically perform external actions.
