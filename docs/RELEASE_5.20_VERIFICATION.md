# Release 5.20.0 verification

## Automated checks

- `pytest -q tests/test_portfolio_matching_v520.py tests/test_service_intelligence_v519.py tests/test_growth_intelligence_v518.py tests/test_source_cohorts_v517.py tests/test_source_trends_v516.py tests/test_source_roi_v515.py tests/test_proposal_outcome_intelligence_v514.py tests/test_proposal_eval_v513.py tests/test_proposal_quality_v512.py tests/test_proposal_claims_v511.py tests/test_proposal_intelligence_v510.py tests/test_risk_aware_opportunity_ranking_v59.py tests/test_retrieval.py tests/test_retrieval_v23.py`
- Python compile check: `python -m compileall -q app` (passed).
- Full backend test collection was attempted but is blocked in this execution environment by missing installed dependencies (`pgvector` and `langgraph`); this is an environment limitation, not a passing full-suite result.

## Manual / environment-dependent checks not claimed

- Frontend production build and TypeScript check require frontend dependencies to be installed; they are not represented as passed by this release packaging step.
- Authenticated PostgreSQL/pgvector integration and browser end-to-end tests require configured isolated services and credentials.
- Real portfolio match quality must be reviewed against the user's actual portfolio and opportunity listings. Lexical evidence matching can miss semantic equivalents.

## Safety and data handling

- Endpoint filters opportunities, profile, chunks and documents by authenticated user ID.
- Endpoint is read-only; no application submission, messaging, contract acceptance, invoice issuance or payment action is triggered.
- No database schema migration or new runtime dependency.
