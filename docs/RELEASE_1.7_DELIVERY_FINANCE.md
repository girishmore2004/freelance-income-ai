# Release 1.7 — Advanced Delivery and Financial Automation

## Product scope
v1.7 extends the v1.6 application pipeline into an organized project delivery and revenue workflow. It adds deliverable records, revision history, an internal review gate, invoice schedules, explicit schedule approval and deterministic cash-flow rollups.

## Delivery workspace
- Create deliverables under an owned project, optionally linking an existing project task.
- Keep title, scope/acceptance notes, file/content reference and due date together.
- Save immutable revision snapshots with version number, change note and SHA-256 content hash.
- Submit a specific content version for internal review.
- Approve or request changes only when the supplied hash matches the exact pending version.
- Editing a pending deliverable invalidates the review and approval hash.
- Record a client handover only after internal approval. The API records a manual delivery reference; it does not send files or messages.
- Record client acceptance or change requests after a handover.

## Financial automation
- Create planned invoice schedules tied to a project and optionally a milestone.
- Approve the exact schedule values using its SHA-256 approval hash.
- Create an invoice record only after schedule approval and an explicit invoice number.
- Invoice creation does not email a client or initiate a payment.
- Cash-flow outlook summarizes recorded paid invoices, overdue receivables, invoices due within the selected horizon and approved/planned schedules not yet invoiced.
- Forecast is deterministic and based only on recorded due dates. It does not predict whether a client will pay on time.

## New APIs
- `POST/GET /api/v1/projects/{project_id}/deliverables`
- `PATCH /api/v1/deliverables/{deliverable_id}`
- `POST /api/v1/deliverables/{deliverable_id}/submit-for-review`
- `POST /api/v1/deliverables/{deliverable_id}/review`
- `POST /api/v1/deliverables/{deliverable_id}/record-delivery`
- `PATCH /api/v1/deliverables/{deliverable_id}/client-status`
- `GET /api/v1/deliverables/{deliverable_id}/revisions`
- `GET /api/v1/projects/{project_id}/delivery-summary`
- `POST /api/v1/projects/{project_id}/invoice-schedules`
- `GET /api/v1/invoice-schedules`
- `POST /api/v1/invoice-schedules/{schedule_id}/approve`
- `POST /api/v1/invoice-schedules/{schedule_id}/issue`
- `GET /api/v1/finance/cashflow-forecast?horizon_days=90`

## Migration
Alembic revision `0015_delivery_finance` follows `0014_marketplace_foundation`.

## UI
- `/delivery`: project deliverables, internal review, invoice schedule and cash-flow outlook.
- Dashboard navigation includes links to `/marketplaces` and `/delivery`.

## Human approval and safety
- No automatic client delivery, email, invoice email, payment collection, refund, discount or financial commitment is performed.
- Internal approval is bound to the exact deliverable hash.
- Invoice record creation is bound to an approved schedule.
- All resources are queried by authenticated user ID.
