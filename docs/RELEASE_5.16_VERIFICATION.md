# Release 5.16.0 verification

## Feature checks
- [x] 30/90/180-day windows are returned by the source-trends service.
- [x] Each funnel stage uses its own persisted event timestamp.
- [x] A proposal in-period can be attributed to an opportunity created before the period.
- [x] Receipt/refund attribution requires invoice → project → originating opportunity linkage.
- [x] Currency amounts are not combined or converted.
- [x] Missing timestamps and unlinked financial events are excluded.
- [x] The UI exposes a 30/90/180-day selector and shows interpretation limitations.

## Test commands
Run focused service tests from `backend/`:

```bash
PYTHONPATH=. pytest -q tests/test_source_trends_v516.py tests/test_source_roi_v515.py tests/test_proposal_outcome_intelligence_v514.py tests/test_proposal_eval_v513.py tests/test_proposal_quality_v512.py tests/test_proposal_claims_v511.py tests/test_proposal_intelligence_v510.py tests/test_risk_aware_opportunity_ranking_v59.py tests/test_retrieval.py tests/test_retrieval_v23.py
```

Also run `python -m compileall -q app` from `backend/`.

## Not claimed
PostgreSQL integration, live provider APIs, frontend production build, browser E2E, and deployment smoke tests require their respective external services/toolchains and are not implied by service-level tests.
