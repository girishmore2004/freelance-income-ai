# Release 1.2 — Pricing Intelligence & Project Profitability

## 1. Calibrated pricing recommendation
`GET /api/v1/pricing/recommendation/{opportunity_id}` returns a recommendation for an opportunity owned by the authenticated user.

Baseline:
- Prefer profile hourly rate × estimated hours.
- Apply the user's minimum project budget.
- If rate/effort is incomplete, use a conservative listing-budget fallback where possible.
- Return insufficient data rather than invent a price when no usable inputs exist.

Historical calibration:
- Uses the latest recorded proposal price for each comparable opportunity with a manually recorded `won` feedback outcome.
- Similarity means same industry OR same work type.
- Requires at least 3 historical wins before applying calibration.
- Blends 70% baseline with 30% historical median.
- Historical median is bounded to 65%–150% of baseline to reduce outlier influence.
- Returns a ±10% indicative range, sample count, confidence label, basis and warnings.

This is a user-specific decision aid, not a market quote, a guarantee of winning or a substitute for scope/risk review. It does not automatically change a proposal price.

## 2. Pricing performance segments
`GET /api/v1/analytics/pricing-segments` groups the latest recorded priced proposal and latest feedback per opportunity by industry, work type, currency and price relative to the listing's budget:
- At or below 80% of listing budget.
- 80–100% of listing budget.
- Above listing budget.
- No listing budget.

The endpoint returns median proposal price, wins, decided sample size and win rate. Outcomes are manually recorded. Small samples are descriptive only; no statistical significance is claimed.

## 3. Project profitability
`GET /api/v1/projects/{project_id}/profitability` combines:
- Project budget.
- Invoices marked paid and non-cancelled invoices.
- Tracked hours.
- Paid revenue per tracked hour.
- User-entered hourly-rate time-value proxy.

The time-value proxy is not an accounting expense, tax calculation or actual profit. Revenue is counted only from invoices marked paid. The endpoint is tenant-scoped.

## 4. No database migration
v1.2 uses existing proposals, feedback, opportunities, projects, invoices and time entries. No schema migration is required.

## 5. API examples
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/pricing/recommendation/OPPORTUNITY_ID

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/analytics/pricing-segments

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/projects/PROJECT_ID/profitability
```

## 6. Human approval and privacy
- Price suggestions never update proposals automatically.
- No client contact or marketplace submission occurs.
- Calibration uses only the authenticated user's recorded data.
- No private data is sent to a model for training.
