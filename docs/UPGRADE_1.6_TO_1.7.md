# Upgrade from v1.6 to v1.7

## Before deployment
1. Keep your v1.6 ZIP and back up the PostgreSQL database.
2. Keep existing `.env`, Render environment variables, Vercel variables and OAuth secrets. Secrets are not included in the ZIP.
3. Extract v1.7 and copy the contents of `freelance-income-ai/` over your existing repository.

## GitHub
From your repository root:

```bash
git status
git add .
git commit -m "Upgrade Freelance Income AI to v1.7 delivery and finance"
git push origin main
```

Push to the branch configured in your deployment if it is not `main`.

## Backend migration
The new Alembic revision is `0015_delivery_finance`, following `0014_marketplace_foundation`.

If your Render startup command does not run migrations automatically, run:

```bash
cd backend
alembic upgrade head
```

Back up PostgreSQL before running it. Do not reset or recreate your database.

## Render and Vercel
- Deploy the backend with existing environment variables unchanged.
- Deploy the frontend with `NEXT_PUBLIC_API_URL` pointing at the existing API.
- Open the app and sign in.
- Open `/delivery` to manage deliverables and invoice schedules.
- `/marketplaces` remains available from v1.6.

## Suggested smoke test
1. Create a test project.
2. Create a deliverable and save a revision.
3. Submit it for internal review and approve the exact version.
4. Record a manual handover reference.
5. Record client acceptance.
6. Create a planned invoice schedule.
7. Approve the schedule and create an invoice record with a test invoice number.
8. Open the cash-flow outlook endpoint and confirm the schedule/invoice appears in the correct currency bucket.

## Safety
No email is sent, no client file is transferred, no payment is collected, and no invoice is emailed by these new endpoints. Handover and invoice actions record steps you have explicitly completed or approved.
