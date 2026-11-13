# Upgrade 3.1 → 3.2

1. Back up the existing PostgreSQL database and verify the dump checksum.
2. Extract v3.2 into a working copy of your existing repository; preserve `.git`, `.env` and deployment settings.
3. Review the dependency scan results in GitHub Actions before deploying.
4. Install backend and frontend dependencies in isolated environments.
5. Run backend tests, frontend typecheck/build and Playwright:
   - `cd backend && pytest -q`
   - `cd frontend && npm install && npm run typecheck && npm run build && npx playwright install chromium && npm run test:e2e`
6. Run the tenant-isolation tests against an isolated PostgreSQL test database.
7. Run the k6 smoke test against staging only, if authorized.
8. Complete an authorized human-reviewed retrieval benchmark before making retrieval-quality claims.
9. Deploy the reviewed commit to Render and Vercel only after required CI jobs pass.

No Alembic migration is included in 3.2. The new dependency audit jobs may identify vulnerabilities in existing pinned dependencies; resolve those findings in a separately reviewed dependency patch rather than suppressing them.
