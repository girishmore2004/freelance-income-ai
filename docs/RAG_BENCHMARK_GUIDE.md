# RAG benchmark authoring and review guide

The bundled `backend/evaluation/grounding_cases.json` file is synthetic. It verifies that the evaluation code runs; it is not evidence of production answer accuracy.

## Safe benchmark construction

1. Use only portfolio/project records that the account owner has explicitly consented to use for evaluation.
2. Remove names, email addresses, phone numbers, client identifiers, credentials, financial account details and other unnecessary personal or confidential information.
3. Keep a stable, non-sensitive `case_id` and evidence IDs. Do not place private source URLs or raw client names in the public repository.
4. Write each claim so that it can be checked against the supplied evidence. Include positive claims, unsupported claims, numeric mismatches, scope/negation cases, stale evidence, and cases where no evidence is available.
5. Have a reviewer label `expected_supported` independently of the model output. Disagreements should be adjudicated and documented; do not label examples to make the current model score well.
6. Mark the dataset `review_status: "human_reviewed"` only after review. Include `review.reviewed_by`, `review.reviewed_at` (ISO 8601) and `review.method`.
7. Keep synthetic, unreviewed and human-reviewed datasets separate. Do not mix their scores into one production metric.
8. Store the benchmark outside the public repository if its evidence cannot be safely redacted. Never commit customer records or secrets.

## Example structure

```json
{
  "dataset_name": "Redacted portfolio grounding benchmark",
  "dataset_version": "1.0",
  "review_status": "human_reviewed",
  "review": {
    "reviewed_by": "reviewer-role-or-team",
    "reviewed_at": "2026-11-12T12:00:00Z",
    "method": "Independent double review with adjudication"
  },
  "cases": [
    {
      "case_id": "redacted-case-001",
      "claims": [
        {
          "claim": "Built a React dashboard for logistics deliveries.",
          "cited_evidence_ids": ["evidence-001"],
          "evidence": [
            {
              "id": "evidence-001",
              "text": "Built a React dashboard for logistics deliveries."
            }
          ],
          "expected_supported": true
        }
      ]
    }
  ]
}
```

## Run validation

From `backend/`:

```bash
python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json
python scripts/evaluate_rag_grounding.py --dataset path/to/reviewed_dataset.json --strict
```

Strict mode checks the declared review status and required reviewer provenance. It does not authenticate the reviewer or prove that labels are correct; governance and review quality remain human responsibilities.

## Metrics and interpretation

- Citation precision/recall measure ID overlap only.
- Unknown citation IDs are integrity failures and make the affected claim unsupported in the lexical evaluator.
- Token coverage, numeric checks and negation checks are heuristic indicators, not semantic entailment.
- A high score on a small or synthetic dataset is not a production accuracy guarantee.
- Retrieval metrics such as recall@k and MRR should be computed on a representative set of known relevant evidence IDs, separately from answer-grounding metrics.
