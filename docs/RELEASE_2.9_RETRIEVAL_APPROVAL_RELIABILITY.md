# Release 2.9 — Retrieval evaluation and approval integrity

## Scope

This release continues v2.8 without replacing the FastAPI, Next.js, PostgreSQL,
Redis/RQ, LangGraph or existing workflow architecture.

## Retrieval benchmark

- Adds a validated, offline retrieval benchmark format.
- Rejects blank queries, duplicate chunk IDs, empty chunk content and relevance
  labels that point to chunks absent from the case.
- Reports hit-rate@k, precision@k, recall@k, MRR@k and nDCG@k, with per-query
  rankings and metric scope.
- Includes a small synthetic smoke dataset. It is not a human-reviewed benchmark
  and must not be presented as production retrieval accuracy.
- No external API, paid embedding service or network call is required.

Run from `backend/`:

```bash
python scripts/evaluate_retrieval.py --dataset evaluation/retrieval_cases.json --k 5
python scripts/evaluate_retrieval.py --dataset path/to/your-reviewed-retrieval-set.json --k 5 --output evaluation/retrieval_report.json
```

The benchmark should contain redacted, consented content. Keep real client or
portfolio data outside the public repository unless explicitly cleared for
publication. Human-reviewed status is a governance declaration, not cryptographic
proof of reviewer identity or label correctness.

## Proposal approval integrity

- A decision is valid only while the approval is pending and its stored proposal
  fingerprint still matches the current proposal.
- `mark-ready` and workflow resume require an approved decision for the exact
  current proposal fingerprint.
- Rejected, superseded, pending or stale-hash approvals cannot satisfy the gate.
- Approval remains a local authorization state. It does not submit a marketplace
  application, send a message, deliver work, issue an invoice or move money.

## Verification

Focused tests cover retrieval dataset validation, ranking metrics and the pure
approval policy checks. The existing API/database integration and browser-based
approval journey still need execution in CI or a provisioned environment.
