# Upgrade Freelance Income AI 5.10.0 → 5.11.0

## What changed
- Adds `backend/app/services/proposal_claims.py` for deterministic factual-claim review.
- Proposal generation responses now include additive `claim_review` metadata.
- Opportunity Intelligence displays the findings and their limitations.
- Adds focused regression tests for experience, quantified outcomes, credentials, named clients and evidence overlap.

## Deployment
1. Back up the existing repository and database.
2. Replace application source with the 5.11.0 release while preserving deployment secrets and environment configuration.
3. Backend: install the pinned requirements and run `pytest -q`.
4. Frontend: run `npm ci`, `npm run typecheck`, and `npm run build`.
5. Deploy backend and frontend using the existing Render/Vercel settings.
6. Generate a proposal in staging and inspect `claim_review` in the response and UI. Verify ordinary approach-only text, numeric claims and credential/client claims.

No database migration or new environment variable is required. Do not send proposals automatically; verify every finding against original user-owned sources and retain the existing explicit approval flow.
