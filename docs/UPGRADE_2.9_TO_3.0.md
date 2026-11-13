# Upgrade from 2.9 to 3.0

1. Back up the production database and deployment configuration.
2. Replace the source with v3.0 while preserving `.git` and all deployment
   environment variables.
3. Ensure the API has `ENVIRONMENT=production`.
4. Set a unique random `SECRET_KEY` of at least 32 characters.
5. Set PostgreSQL `DATABASE_URL`, Redis `REDIS_URL`, HTTPS `FRONTEND_URL`,
   and explicit HTTPS `CORS_ORIGINS` that includes the exact `FRONTEND_URL` origin (no trailing slash or path).
6. If Google or Microsoft OAuth is enabled, set `OAUTH_ENCRYPTION_KEY`.
7. From `backend/`, run:

   ```bash
   pip install -r requirements.txt
   ENVIRONMENT=production python scripts/production_preflight.py
   pytest -q
   ```

8. Run frontend verification:

   ```bash
   cd frontend
   npm install
   npm run typecheck
   npm run build
   ```

9. Push the reviewed release to GitHub and deploy the same commit to Render and
   Vercel. Check API health, login, proposal edit/approval and workflow pages.

No database migration is introduced in v3.0. The startup guard will intentionally
refuse production boot when required security and infrastructure settings are
missing or insecure. External actions remain human-approved.
