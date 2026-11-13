# Upgrade 3.0 → 3.1

1. Back up your current PostgreSQL database.
2. Merge the 3.1 source changes into your existing repository; preserve `.git`, deployment settings and `.env`.
3. Install frontend dependencies with `cd frontend && npm install`.
4. Install Playwright Chromium once in CI or local test environments: `npx playwright install chromium`.
5. Run backend tests and frontend checks:
   - `cd backend && pytest -q`
   - `cd frontend && npm run typecheck && npm run build && npm run test:e2e`
6. Deploy the reviewed commit to the API and frontend hosting services.
7. Verify `https://YOUR-API/health` using `python backend/scripts/check_health.py --url ...`.
8. Configure protected database backups and perform a restore drill in a separate recovery database.

No Alembic migration is included. Do not run the restore script against production unless you have explicitly approved a disaster-recovery operation.
