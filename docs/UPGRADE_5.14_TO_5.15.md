# Upgrade 5.14.0 → 5.15.0

## Included
- Source-performance service now accepts manually recorded project cost entries and a minimum decided sample.
- Authenticated endpoint: `GET /api/v1/analytics/source-performance?minimum_sample=5`.
- Analytics UI includes unknown outcomes, decided sample, attributed costs and ROI by currency.
- ROI requires both positive paid revenue and positive attributed project costs in the same currency.

## Attribution rules
- Revenue: paid invoice → project → originating opportunity → source.
- Costs: manually recorded ClientCostEntry → project → originating opportunity → source.
- Client-level/unlinked costs, unpaid invoices and unlinked revenue are excluded.
- No currency conversion is performed.

## Compatibility
- No database migration, new environment variable or new runtime dependency.
- Existing proposal approval, external communication and marketplace submission controls are unchanged.

## Verification
```bash
cd backend
PYTHONPATH=. pytest -q tests/test_source_roi_v515.py tests/test_proposal_outcome_intelligence_v514.py tests/test_proposal_eval_v513.py tests/test_proposal_quality_v512.py tests/test_proposal_claims_v511.py tests/test_proposal_intelligence_v510.py
```
