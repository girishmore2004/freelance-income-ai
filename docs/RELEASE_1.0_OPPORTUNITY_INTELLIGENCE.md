# Release 1.0 — Explainable Opportunity Intelligence

## Smart ranking
`GET /api/v1/opportunities/ranked` returns the user's opportunities sorted by a transparent rank score:
- 70% profile match score already computed by the opportunity scoring engine.
- 20% freshness decay based on publication date, last-seen date or creation date.
- 10% feedback prior based on the user's own recorded wins/losses in a similar industry or work type.

Freshness decays exponentially with a 21-day half-life-like scale (exp(-age/21)). Missing dates receive a neutral freshness score of 50. Feedback uses a Beta(2,2) prior and confidence scales with sample count; fewer than three relevant outcomes are called out. Outcomes other than `won`, `lost`, `rejected`, `no_response`, `not_relevant` and `client_risk` do not affect calibration.

The endpoint returns component contributions, reasons, age, feedback sample count and ranking version. It does not mutate the stored base `match_score`.

## UI
The Opportunities tab now has **Smart rank opportunities** and **Recent order** controls. Smart mode shows the rank score and its explanation on each opportunity.

## API example
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/opportunities/ranked
```

## Boundaries
- Feedback calibration is a small personalized prior, not a trained predictive model. It must not be interpreted as a probability of winning.
- The ranking is deterministic and explainable; it does not claim an LLM has independently validated opportunity quality.
- Provider-specific marketplace connectors and email OAuth are not enabled by this release. Generic RSS/public JSON discovery remains unchanged.
- Human approval remains required for proposals and all external actions.
