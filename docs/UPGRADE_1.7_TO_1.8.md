# Upgrade from v1.7 to v1.8

## Before updating
1. Keep your v1.7 ZIP and take a PostgreSQL backup.
2. Preserve your existing `.env`, Render environment variables, Vercel variables and provider/email secrets.
3. Extract v1.8 and copy the contents of `freelance-income-ai/` into your existing GitHub repository.

## GitHub push

```bash
git status
git add .
git commit -m "Upgrade Freelance Income AI to v1.8 business intelligence"
git push origin main
```

Use your configured deployment branch if it is not `main`.

## Database migration
v1.8 adds `0016_project_opportunity_attribution` after `0015_delivery_finance`. It adds a nullable project-to-opportunity attribution field; existing projects remain unlinked until you explicitly link them.

Back up the database, then run if the API startup does not already apply migrations:

```bash
cd backend
alembic upgrade head
```

Do not reset the production database.

## Deployment
- Deploy backend to the existing Render service.
- Deploy frontend to the existing Vercel project.
- Preserve `NEXT_PUBLIC_API_URL` and all existing environment variables.
- Sign in and open `/analytics`.

## How to use source revenue attribution
1. Select an existing project in the analytics attribution section.
2. Select the opportunity that originally generated the project.
3. Save attribution.
4. Only paid invoices linked to that project will count as revenue for that source.
5. Unlinked projects and unpaid invoices are excluded.

## Verification checklist
- Review funnel counts against saved opportunities, proposals, application records and manually entered feedback.
- Enter time entries with dates and rates to improve capacity and project profitability reporting.
- Verify invoice currencies separately; the application does not convert currencies.
- Weighted pipeline remains hidden until at least five decided feedback outcomes are available.

## Interpretation
This release reports historical records and transparent estimates. It does not guarantee future earnings or predict payment behavior. No external marketplace, client or payment action is performed by analytics.
