# Upgrade guide: v5.0.0 to v5.1.0

## What changes
v5.1.0 adds an append-only invoice payment evidence ledger. It records manual receipts, refunds, and dispute-open/resolved events against invoices. It does not connect to banks, payment gateways, or processors and does not initiate or verify transactions.

## Before upgrading
1. Take and verify a PostgreSQL backup using the existing backup procedure.
2. Deploy from a release branch and review CI.
3. Confirm your database is currently at Alembic revision `0024_contract_delivery_history`.

## Upgrade
Run the migration once from the backend environment after deploying the compatible release code:

```bash
cd backend
alembic upgrade head
```

The new migration is `0025_invoice_payment_ledger`. It creates `invoice_payment_events`; it does not rewrite existing invoices or invent payment history.

## API
- `POST /api/v1/invoices/{invoice_id}/payment-events` — append a receipt, refund, dispute-opened, or dispute-resolved event.
- `GET /api/v1/invoices/{invoice_id}/payment-events` — view an invoice's reconciliation and event history.
- `GET /api/v1/payment-reconciliation` — workspace totals grouped by currency.

Receipt/refund entries require a positive amount, invoice-matching currency and an evidence reference of at least eight characters. Refunds cannot exceed net receipts recorded in the ledger. Dispute events require amount zero and evidence. A dispute must be open before it can be resolved. Event records have no edit/delete API.

## Compatibility
- Existing invoices remain intact.
- Legacy invoices already marked `paid` are treated as paid in summaries until a payment ledger event is recorded for that invoice. Once the ledger is started, the event ledger becomes the reconciliation source of truth.
- Currency totals are never converted or combined.
- Client profitability now uses net ledger receipts where events exist; otherwise it preserves the legacy `paid` invoice status.
- Existing invoice status endpoints remain for compatibility, but payment reconciliation uses the event ledger when present.

## Rollback
Prefer application rollback while retaining the additive table. Downgrading revision 0025 drops payment-event history and its indexes. Only downgrade if the data is disposable and a verified backup exists:

```bash
alembic downgrade 0024_contract_delivery_history
```

Do not run migrations concurrently from multiple API replicas.

### Legacy paid invoice refunds
If an older invoice is marked `paid` but has no payment ledger events, first record the original receipt with its historical evidence reference. Then record any refund against that ledger receipt. This creates an explicit auditable starting point rather than fabricating prior payment events.
