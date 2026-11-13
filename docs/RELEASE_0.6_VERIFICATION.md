# Release 0.6 verification

```bash
cd backend
python -m pip install -r requirements.txt
alembic upgrade head
pytest -q
python -m compileall -q app
cd ../frontend
npm ci
npm run typecheck
npm run build
cd ..
docker compose config
docker compose build
docker compose up -d
```

Manual checks:
1. Create/login to a user account and add an opportunity.
2. Open Research and select that opportunity.
3. Save an official profile or contract evidence item with an HTTPS source URL.
4. Save another item without a URL and confirm it remains visibly unverified.
5. Run risk screening and inspect the evidence coverage and limitations.
6. Add a listing that asks for a registration fee; verify the upfront-payment warning.
7. Add a listing requesting OTP/password; verify the credential warning.
8. Run assessment with no evidence and confirm `insufficient_data`, not `low`.
9. Retrieve saved assessment history.
10. Confirm all API endpoints reject requests without authentication.


## Checks performed while packaging this release
- Python AST parsing: passed for all project Python files.
- Focused pure-service tests: 19 passed (risk rules, scoring, retrieval, specialist helpers).
- Full API test collection: blocked in this build environment because `pgvector` is not installed; install `backend/requirements.txt` before running the full suite.
- Frontend TypeScript check: dependencies are not installed in the packaging environment. TypeScript parser reported no TS1xxx syntax diagnostics, but typecheck/build still need to be run after `npm ci`.
- Docker image build and real PostgreSQL migration were not run in this environment.
