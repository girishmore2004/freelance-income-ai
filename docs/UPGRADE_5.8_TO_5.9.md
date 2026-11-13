# Upgrade Freelance Income AI 5.8.0 → 5.9.0

## Changes

- Integrates the existing client-risk screening rules into the opportunity intelligence response.
- Adds a confidence-weighted risk-quality component to opportunity ranking.
- Exposes risk findings, evidence coverage, questions to ask and limitations in each intelligence item.
- Preserves v1 ranking behavior for callers that do not supply a risk assessment.

## Deployment

1. Back up the current repository and database.
2. Replace application files with this release while preserving `.git`, `.env`, uploads and deployment secrets.
3. No Alembic migration is required; do not edit or replay existing migrations.
4. Install the pinned backend requirements and run the backend test suite.
5. Run frontend typecheck/build and the repository CI workflow.
6. Deploy to staging, verify `/api/v1/opportunity-intelligence`, and confirm risk findings are advisory only.
7. Promote to production only after the exact commit has a green CI run and deployment smoke tests pass.

## Compatibility

- API response additions are additive: `client_risk`, `ranking.risk_assessment`, `ranking.components.risk_quality` and ranking version `v2-risk-aware`.
- Existing consumers should ignore unknown fields and should not assume a fixed component-key set.
- No marketplace mutation or proposal submission is introduced.
