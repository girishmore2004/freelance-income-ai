# Human-reviewed retrieval benchmark protocol

## Purpose

The built-in retrieval benchmark measures ranking against labelled chunk IDs. It cannot establish answer correctness or the quality of labels. A synthetic smoke fixture is a code-regression check, not evidence of production retrieval quality.

## Dataset governance

Before using a dataset for a release decision:

1. Use only documents the account owner has explicitly authorized for evaluation.
2. Remove personal data, credentials, client-confidential details and unrelated content.
3. Record the source collection, collection date, permitted-use basis and data custodian.
4. Have a human reviewer label relevant chunk IDs for each realistic query.
5. Have a second reviewer independently label a sample and resolve disagreements.
6. Record reviewer identity or approved reviewer code, review date, rubric version and adjudication notes.
7. Do not copy private client data into public CI artifacts or public repositories.

## Required case structure

Each case must include:
- A unique `case_id`.
- A realistic, non-leading `query`.
- Candidate `chunks` with stable unique `id` and non-empty `content`.
- A non-empty `relevant_chunk_ids` array referencing IDs in that case.

The dataset root should include provenance metadata as described by `docs/RAG_BENCHMARK_GUIDE.md`. Never claim a dataset is human-reviewed unless a named/approved reviewer actually reviewed it.

## Labelling rubric

Mark a chunk relevant only when it contains information that materially helps answer the query. Do not mark a chunk relevant merely because it shares keywords. When a query needs multiple facts, label every chunk needed to support a complete answer. If no supplied chunk supports the query, use an explicitly documented unanswerable-case policy rather than inventing a relevant ID.

## Metrics and release interpretation

Run:

```bash
cd backend
python scripts/evaluate_retrieval.py --dataset evaluation/human_reviewed_retrieval.json --k 5 --output evaluation/human_reviewed_report.json
```

Review hit rate, precision@k, recall@k, MRR and nDCG together. Investigate per-case details and reviewer disagreements. Define acceptance thresholds before looking at the result, stratify by query type, and compare against the previous release on the same fixed dataset. Do not tune thresholds after seeing results and then present them as pre-registered.

A passing score does not prove grounded generation, factual answer correctness, privacy safety or production suitability. Pair retrieval metrics with the RAG grounding evaluator and human review of generated answers.

## CI policy

Only synthetic fixtures belong in ordinary public CI. Human-reviewed datasets should remain private when they contain confidential source material. A sanitized aggregate report may be shared only after an authorized reviewer approves it.
