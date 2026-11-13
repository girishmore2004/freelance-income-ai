# Upgrade guide: v5.1.0 to v5.2.0

## Release scope
v5.2.0 adds manually recorded direct client costs, expanded profitability by currency, and transparent client relationship-health insights.

## Before upgrading
1. Back up PostgreSQL and verify the backup.
2. Create a release branch and review CI.
3. Confirm the current Alembic revision is `0025_invoice_payment_ledger`.

## Upgrade
Run once after deploying compatible code:

```bash
cd backend
alembic upgrade head
```

Migration: `0026_client_cost_entries`.

## New API endpoints
- `POST /api/v1/clients/{client_id}/costs` — record direct cost.
- `GET /api/v1/clients/{client_id}/costs` — list direct costs.
- `GET /api/v1/clients/{client_id}/insights` — explainable relationship-health and payment-behavior summary.
- Existing `GET /api/v1/clients/{client_id}/profitability` now includes direct costs and currency-separated cash contribution estimates.

## Cost data
Direct costs are owner-entered and may be linked to a project owned by the same user and assigned to the selected client. Cost records have no edit/delete API in this release. No bank account or accounting integration is connected.

## Health scoring
The 0–100 client health score is a deterministic, explainable heuristic using invoice balances, overdue balances, fully settled invoice payment delays, recorded contact recency, and client status. It is not an AI prediction, credit score, or probability of default. Missing data is shown as missing, not as positive evidence.

## Financial interpretation
- Time-entry hourly rates are treated as labor-cost proxies.
- Direct costs include only manual cost records.
- Cash contribution estimate = net recorded receipts − recorded labor proxy − direct costs.
- Revenue, receipts, costs and balances are grouped by currency. No FX conversion is performed.
- It is not accounting profit, tax advice, or an audited financial statement.

## Rollback
Prefer application rollback while retaining the additive table. Downgrade drops client cost records and indexes:

```bash
alembic downgrade 0025_invoice_payment_ledger
```

Only downgrade if the data is disposable and a verified backup exists. Do not run migrations concurrently across API replicas.
