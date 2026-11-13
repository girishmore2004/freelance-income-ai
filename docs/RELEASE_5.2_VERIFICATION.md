# v5.2.0 verification report

## Scope
Direct client cost records, currency-separated profitability, transparent relationship health, payment timing signals, and client activity timeline integration.

## Checks performed
- Focused client BI, payment ledger, contract policy and revision chain tests: **26 passed**.
- Python compilation for backend application and tests.
- TypeScript TSX syntax transpilation for new Client Insights page, dashboard and existing CRM page.
- Static Alembic revision-chain inspection.
- Release ZIP CRC and per-file SHA-256 manifest validation.
- Secret/cache exclusion scan.

## Limitations
No live PostgreSQL instance was available to execute the migration or API integration tests. No live Redis/RQ or cloud deployment was available. TSX transpilation is not a full TypeScript typecheck and no Next.js production build or Playwright run was performed. Relationship health is a transparent heuristic, not an AI prediction. Financial metrics use recorded data only and are not accounting statements.

## Static migration inspection
The migration files form one linear static revision chain ending at `0026_client_cost_entries`, whose parent is `0025_invoice_payment_ledger`. This is source inspection only; it is not a live Alembic upgrade test.
