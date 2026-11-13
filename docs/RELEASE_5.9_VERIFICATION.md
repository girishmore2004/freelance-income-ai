# Release 5.9.0 verification — risk-aware opportunity intelligence

## Scope

- Opportunity intelligence runs the existing deterministic client-risk rules against each listing title and description.
- Each intelligence item returns `client_risk` with risk score/level, evidence coverage, matched signals, source provenance, questions to ask and limitations.
- Ranking v2 allocates 65 points to current profile match, 20 to freshness, 10 to the smoothed similar-outcome prior and 5 to evidence-confidence-weighted risk quality.
- Sparse evidence is neutral-weighted rather than interpreted as proof of safety or wrongdoing.
- Direct calls to `rank_opportunity` without a risk assessment retain the v1 formula for backwards compatibility.
- Opportunity Intelligence UI displays risk level and evidence coverage, and includes ranking/risk details in its expandable review panel.
- No database migration, provider permission or new environment variable is required.
- No marketplace mutation or external proposal submission is introduced.

## Checks executed in this packaging environment

- Python `compileall` for backend application, tests, scripts and migrations: **PASS**.
- Focused ranking/intelligence tests, including new v5.9 risk-aware cases: **10 passed**.
- Frontend package JSON parse: **PASS**.
- TypeScript TSX transpilation for the changed Opportunity Intelligence page: **PASS**.
- Full backend pytest collection: **BLOCKED** because this environment does not contain the pinned dependencies (including `langgraph` and `pgvector`). Installing `backend/requirements.txt` was attempted, but package-index DNS/network access was unavailable.
- Full Next.js typecheck/build and browser E2E: **NOT RUN** because frontend dependencies are not installed and network access is unavailable.
- PostgreSQL/pgvector migration execution and live Upwork OAuth/GraphQL workflows: **NOT RUN**.

## Interpretation safeguards

- Keyword screening can produce false positives and false negatives.
- Listing-level screening is not an independent background check.
- A low risk score does not guarantee that a client or project is safe.
- Missing evidence is not proof of a safe client; its influence is neutral-weighted.
- This release is not production-certified until CI and staging checks pass on the exact commit.
