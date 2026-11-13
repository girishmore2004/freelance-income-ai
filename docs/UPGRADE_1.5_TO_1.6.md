# Upgrade from v1.5 to v1.6

## 1. Back up
- Download and retain your v1.5 ZIP.
- Export a PostgreSQL backup before deployment.
- Keep your existing Render/Vercel environment variables and OAuth secrets. Do not copy secrets into Git.

## 2. Replace repository files
Extract the v1.6 ZIP. Copy the contents of the `freelance-income-ai/` directory into your existing GitHub repository, replacing tracked files. Preserve your production `.env`/Render environment settings; `.env` is intentionally not included in the ZIP.

## 3. Commit and push
From the repository root:

```bash
git status
git add .
git commit -m "Upgrade Freelance Income AI to v1.6 marketplace foundation"
git push origin main
```

If your deployment branch is not `main`, push to the configured branch instead.

## 4. Deploy backend
- Confirm Render still points to the existing backend service and correct root directory.
- Confirm `DATABASE_URL`, `SECRET_KEY`, `FRONTEND_URL`, CORS settings, and existing AI/email settings remain configured.
- Deploy the latest commit.
- Ensure the API startup runs `alembic upgrade head`; otherwise run the migration command in the backend shell:

```bash
cd backend
alembic upgrade head
```

The new revision is `0014_marketplace_foundation`. Back up the database first.

## 5. Deploy frontend
- Confirm Vercel points to the existing frontend directory.
- Keep `NEXT_PUBLIC_API_URL` set to the deployed API base URL.
- Deploy the same commit.

## 6. Verify
1. Sign in and open `/marketplaces`.
2. Confirm provider cards load.
3. Create a marketplace application record linked to an existing opportunity.
4. Attach an existing proposal through the API if you want to test the approval gate.
5. Approve using the exact current proposal SHA-256 hash.
6. If you submit manually on the marketplace website, record its external reference in the app.
7. Confirm audit events and status changes.

## Important
v1.6 does not perform live marketplace OAuth, job search or proposal submission. Changing a provider's readiness setting does not grant API access. Do not paste API secrets into the settings endpoint. Existing opportunity discovery, proposal drafting, approval, email and project workflows are preserved.
