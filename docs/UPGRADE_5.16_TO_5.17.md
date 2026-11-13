# Upgrade 5.16.0 → 5.17.0

## What changed
- Added `GET /api/v1/analytics/source-cohorts`.
- Cohort membership is determined by `Opportunity.created_at` within rolling 30/90/180-day windows.
- For each cohort opportunity, the service checks later `Proposal.created_at`, submitted application state plus `submitted_at`, latest eligible `Feedback.created_at`, linked `Project.created_at`, and recorded receipt/refund payment events.
- Downstream events must occur on/after opportunity creation and no later than the report date.
- Added cohort conversion tables to Business Intelligence, using the existing 30/90/180-day selector.

## Interpretation safeguards
- Cohort counts are distinct opportunities, not raw event counts.
- Win rate uses only the latest eligible feedback per opportunity and only `won`, `lost`, or `rejected` as decided outcomes. `no_response` is not a decided win/loss.
- Cohort cash is net receipts less refunds and is linked only through invoice → project → originating opportunity. Currency buckets are never combined.
- Cohorts are observed through the report date. Newer cohorts have had less time to convert; average cohort age is displayed.
- This is not causal attribution, a prediction, or proof that a marketplace listing generated the payment.
- Missing timestamps and unlinked records are excluded. No external submissions or client messages are initiated.

## Compatibility
- No database migration.
- No new runtime dependency.
- Existing endpoints and user-scoped queries remain unchanged.
