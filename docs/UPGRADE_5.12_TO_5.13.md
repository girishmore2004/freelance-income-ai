# Upgrade 5.12.0 → 5.13.0

## Included
- Offline proposal-quality regression evaluator.
- Eight synthetic fixtures covering injection, pricing, empty drafts and clean drafts.
- CLI: `python ops/evaluate_proposals.py`.
- Unit tests: `backend/tests/test_proposal_eval_v513.py`.

## Compatibility
- No schema or database migration.
- No new environment variables or external API dependencies.
- Existing proposal generation, portfolio evidence review and hash-bound approval flow are unchanged.

## Verification
From repository root:
```bash
cd backend
PYTHONPATH=. pytest -q tests/test_proposal_eval_v513.py tests/test_proposal_quality_v512.py tests/test_proposal_claims_v511.py tests/test_proposal_intelligence_v510.py
cd ..
python ops/evaluate_proposals.py
```

The included dataset is synthetic, small and authored for deterministic regression checks. Precision/recall describe only these fixtures; they are not real-world model quality metrics or proof of factual truth. Continue human review before external communication.
