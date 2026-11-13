# Release 1.1 verification

## Backend checks
```bash
cd backend
pytest -q
alembic upgrade head
```

Verify:
1. User A cannot read/create a time entry for User B's project.
2. A task ID must belong to the selected project and current user.
3. Invalid dates and durations are rejected.
4. Time-entry billable value is minutes / 60 × rate.
5. Finance summary excludes paid invoices from outstanding totals.
6. Due dates earlier than today appear as overdue; dates 0–14 days ahead appear in due soon.
7. Proposal win rate uses manually recorded outcomes and exposes sample size.
8. Delivery plan endpoint returns suggestions without creating tasks or milestones.

## Frontend checks
```bash
cd frontend
npm ci
npm run typecheck
npm run build
```
Use Delivery to generate a preview and log time. Use Finance to load revenue analytics and inspect invoice reminders.

## Deployment
```bash
docker compose config
docker compose build
docker compose up -d
```

## Checks performed during packaging
- Python AST parsing, JSON validation and Compose YAML parsing.
- Focused tests from prior releases plus release 1.1 tests.
- ZIP integrity and manifest hashes.
- Full DB-backed API integration, migration execution, Docker build and frontend production build must still be performed in a configured environment; do not infer these passed from static checks.
