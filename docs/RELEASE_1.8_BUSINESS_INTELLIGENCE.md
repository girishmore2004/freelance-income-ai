# Release 1.8 — Business Intelligence and Forecasting

## Scope
v1.8 adds analytics derived from the user's saved opportunity, proposal, application, feedback, project, invoice and time-entry records. It is deterministic and explainable; it does not fabricate marketplace events, revenue attribution or payment predictions.

## Analytics modules
1. **Conversion funnel:** opportunities, opportunities with proposals, application records, recorded submissions, wins, non-wins and sample-aware win rate.
2. **Source performance:** opportunity/application/win outcomes by source. Paid invoice revenue is attributed only when the user explicitly links a project to its originating opportunity.
3. **Capacity:** profile weekly-hours target compared with recorded hours over a configurable 7–180-day lookback; billable and non-billable hours separated.
4. **Project profitability:** paid invoice revenue, budget, logged hours and estimated billable labor cost. Margin is withheld when hourly-rate or currency data is insufficient. Tax, platform fees, overhead and unlogged work are excluded.
5. **Earnings outlook:** paid invoices, overdue invoices, invoices due within a 7–365-day horizon, approved schedules not invoiced, and open proposal value. Weighted pipeline estimate appears only after at least five manually recorded decided outcomes; it uses the user's historical outcome rate and is clearly labeled as a rough estimate.

## Project/source attribution
Migration `0016_project_opportunity_attribution` adds nullable `projects.origin_opportunity_id`. Use `PUT /api/v1/projects/{project_id}/origin-opportunity` to explicitly link or unlink the project. The endpoint verifies both records belong to the authenticated user. Only paid invoices attached to a linked project count as source-attributed revenue.

## New APIs
- `GET /api/v1/analytics/funnel`
- `GET /api/v1/analytics/source-performance`
- `GET /api/v1/analytics/capacity?lookback_days=28`
- `GET /api/v1/analytics/project-profitability`
- `GET /api/v1/analytics/earnings-outlook?horizon_days=90`
- `PUT /api/v1/projects/{project_id}/origin-opportunity`

## UI
- `/analytics`: conversion funnel, source performance, source attribution, capacity, project profitability and earnings outlook.
- Dashboard navigation links to `/analytics`.

## Data-quality and interpretation rules
- Win rate uses manually entered feedback outcomes and is null when there are no decided outcomes.
- Source-level revenue excludes unlinked projects and unpaid invoices.
- Currency buckets are never converted or summed across currencies.
- Capacity is based on recorded time; missing logs are not assumed to be idle.
- Project margin is partial and excludes taxes, fees, overhead and unrecorded work.
- Open proposals are pipeline value, not booked or guaranteed revenue.
- Weighted pipeline is withheld unless at least five decided outcomes exist.
