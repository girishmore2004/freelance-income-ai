# Upgrade 3.4 → 3.5

1. Back up the database and preserve the existing `.env`, `.git`, and deployment configuration.
2. Extract/copy the release files over the existing repository. No Alembic migration is required for 3.5.
3. Keep `REDIS_URL` configured: distributed rate limiting and abuse-event deduplication depend on it.
4. Install backend dependencies using the existing lock/requirements workflow.
5. Run backend tests and the frontend typecheck/build in CI.
6. Commit and push:

```bash
git status
git add -A
git commit -m "Upgrade Freelance Income AI to v3.5.0"
git push origin main
```

7. After deployment, call `/health` and `/ready`, then authenticate and check `/api/v1/usage/ai` and `/api/v1/security/abuse-events`.
8. Verify that one account cannot see another account's usage or abuse events. Do not expose these endpoints publicly or remove authentication.
