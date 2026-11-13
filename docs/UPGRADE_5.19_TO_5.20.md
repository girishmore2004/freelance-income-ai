# Upgrade v5.19.0 → v5.20.0

## What changed

- Added `backend/app/services/portfolio_matching.py` for deterministic, explainable profile and portfolio matching.
- Added authenticated `GET /api/v1/analytics/opportunity-fit`.
- Added the Portfolio-to-opportunity fit intelligence section to Business Intelligence.
- Added regression tests in `backend/tests/test_portfolio_matching_v520.py`.
- Updated backend/frontend/repository versions to 5.20.0.

## Scoring behavior

- Profile skill fit, indexed portfolio evidence and service alignment are separate signals. Their default weights are 50%, 35% and 15%; weights are renormalized only across signals that can actually be evaluated.
- No structured required skills means skill coverage cannot be scored reliably.
- No portfolio chunks means portfolio evidence score is withheld, not set to zero.
- Potential gaps are based on structured requirements and the user's saved profile; they are not a judgment of overall ability.
- Opportunity quality is a separate listing-completeness indicator for scope, budget, client identity and deadline. It is not a scam detector, client-quality guarantee or payment prediction.
- Portfolio excerpts are lexical matches, not independent verification that the user authored or delivered the work.

## Deployment

No database migration or new Python/Node dependency is required. Deploy the backend and frontend updates together. Existing user profile and portfolio records are reused. The new analytics section loads through the authenticated API after sign-in.
