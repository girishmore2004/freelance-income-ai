# Upgrade 5.15.0 → 5.16.0

## What changed
- Added `GET /api/v1/analytics/source-trends`.
- The endpoint returns 30-, 90- and 180-day source activity windows.
- Opportunity intake uses `Opportunity.created_at`; proposal creation uses `Proposal.created_at`; application submission uses `MarketplaceApplication.submitted_at`; outcomes use `Feedback.created_at`.
- Cash receipts and refunds use append-only `InvoicePaymentEvent` records and are attributed only through `Invoice.project_id` → `Project.origin_opportunity_id` → `Opportunity.source`.
- Added a selectable time-window table to the Business Intelligence page.

## Compatibility
- No database migration.
- No new Python or JavaScript dependencies.
- Existing analytics endpoints and source ROI calculations remain unchanged.
- All endpoint queries remain scoped to the authenticated user's `user_id`.

## Interpretation safeguards
- This is period activity, not a same-cohort funnel. A proposal or payment recorded in a period can belong to an older opportunity.
- Invoice status alone is not treated as cash received.
- Missing timestamps, unlinked invoices/projects, and cross-user records are not inferred or included.
- Receipts and refunds remain separated by currency; no FX conversion occurs.
