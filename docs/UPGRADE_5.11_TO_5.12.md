# Upgrade 5.11.0 → 5.12.0

## Changes
- Adds `backend/app/services/proposal_quality.py`.
- Proposal generation response includes additive `quality_review` metadata.
- Opportunity Intelligence displays quality score, transparent checks, flags and limitations.
- Updates app and frontend package versions to 5.12.0.

## Compatibility
- No database migration.
- No new environment variables.
- Existing proposal generation, editing and approval endpoints remain unchanged.
- Existing approval remains separate; quality checks never approve or send a proposal.

## Upgrade steps
1. Back up the repository and database.
2. Merge/replace application source with this release while preserving deployment secrets and environment configuration.
3. Install backend requirements and run `pytest -q`.
4. In `frontend`, run `npm ci`, `npm run typecheck` and `npm run build`.
5. Deploy to staging first; test proposal generation with a normal listing, prompt-injection text, no quote, a quote within budget and a quote above budget.
6. Promote to production only after full CI and staging checks pass.
