# Upgrade 5.13.0 → 5.14.0

## Included
- New service: `backend/app/services/proposal_outcome_intelligence.py`.
- New authenticated endpoint: `GET /api/v1/analytics/proposal-intelligence?minimum_sample=5`.
- Analytics dashboard section comparing source and basic proposal-check bands.
- Latest proposal and latest feedback per opportunity are counted once.
- Unknown/no-response/undecided outcomes are excluded from decided win-rate denominator.
- Minimum decided sample is configurable from 2 to 50; default is 5.

## Compatibility
- No database migration.
- No new runtime dependency or environment variable.
- Existing proposal approval and external action controls are unchanged.

## Verification
```bash
cd backend
PYTHONPATH=. pytest -q tests/test_proposal_outcome_intelligence_v514.py tests/test_proposal_eval_v513.py tests/test_proposal_quality_v512.py tests/test_proposal_claims_v511.py tests/test_proposal_intelligence_v510.py
```

The comparisons are descriptive, not causal. Proposal basic-check scores are deterministic heuristics and do not prove factual accuracy or persuasive quality.
