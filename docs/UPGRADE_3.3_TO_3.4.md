# Upgrade 3.3 → 3.4

1. Back up PostgreSQL using the existing `ops/backup_postgres.sh` procedure.
2. Merge the release into the existing repository; preserve `.git`, deployment secrets and your `.env`.
3. Add backend environment variables:

```dotenv
AI_QUOTA_DAILY_CALLS=20
AI_QUOTA_MONTHLY_CALLS=300
```

4. Ensure `DATABASE_URL` and `REDIS_URL` are configured as in 3.3.
5. Run the migration from the backend directory:

```bash
alembic upgrade head
```

6. Run backend tests and the frontend typecheck/build in CI. Check `/health` and `/ready` after deployment.
7. Authenticate and call `GET /api/v1/usage/ai`; verify the returned values are scoped to that account.
8. Review quota settings before opening registration broadly. A quota is an operational safeguard, not a billing meter.

Git commands:

```bash
git status
git add -A
git commit -m "Upgrade Freelance Income AI to v3.4.0"
git push origin main
```

No external marketplace proposal, email, invoice or payment is submitted by this upgrade. Existing human approval gates remain in place.
