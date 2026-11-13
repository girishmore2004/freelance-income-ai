# Upgrade v5.37.0 to v5.38.0

## What changes
- Approved handover snapshots can be exported as PDF after the stored snapshot SHA-256 is rechecked.
- Handover snapshot content now includes project-linked invoice reconciliation and the exact manual payment-event evidence references.
- A new read-only project closeout checklist checks latest-revision acceptance, open delivery issues, scope-change approval/client acceptance, invoice balances, payment disputes and audit-chain integrity.
- Delivery workspace displays closeout blockers and offers a PDF download for approved snapshots.

## Database
No database migration is required. This release reuses existing invoice, payment-event, delivery, scope-change and handover snapshot tables.

## Runtime
No new runtime dependency. ReportLab is already pinned in `backend/requirements.txt`.

## Deploy
1. Back up the source and database.
2. Replace the repository source with v5.38.0 and push to GitHub.
3. Deploy backend and frontend using the existing Render/Vercel configuration.
4. No `alembic upgrade` command is required for this release.
5. Open Delivery & Finance Workspace, select a project and review Project Closeout Readiness.
6. Create and review a handover snapshot, approve that exact snapshot, then download the PDF.

## Important
- Draft snapshots cannot be exported as PDF.
- Export validates the approved snapshot's SHA-256.
- Payment reconciliation is based on manually entered payment ledger events. It is not a bank or payment-processor confirmation.
- Legacy invoice `paid` status without ledger events is disclosed as legacy status only.
- No client communication, payment collection, contractual action or automatic project closure is performed.
