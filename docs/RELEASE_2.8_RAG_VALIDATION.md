# Release 2.8 — RAG Citation Integrity and Validation

## What changed
- Citation IDs are checked against the evidence IDs actually present in each claim's retrieved evidence set.
- Unknown citation IDs are surfaced in per-claim details and force the lexical grounding result to `supported=false`.
- Citation metrics can optionally receive `available_ids` and report unknown IDs separately from expected-vs-cited overlap.
- Grounding datasets now receive structural validation before evaluation: required case/claim/evidence fields, unique IDs, boolean labels and valid citation references.
- A dataset marked `human_reviewed` must include reviewer, review date and review method metadata.
- CLI supports `--strict`, which refuses to treat synthetic/unreviewed data as a human-reviewed benchmark.
- CI now provisions PostgreSQL with pgvector and Redis, runs the Alembic migration chain, runs backend tests including service integration checks, evaluates the RAG smoke fixture, and builds/typechecks the frontend.

## Important quality boundary
The evaluator remains deterministic and lexical. It checks token coverage, numbers, negation and citation integrity. It does **not** perform semantic entailment, prove factual correctness, or replace human review. The bundled dataset is synthetic and is only a smoke fixture. Its score must not be used as a production accuracy claim or deployment gate.

## Run locally
From `backend/`:

```bash
python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json --output evaluation/smoke_report.json
python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json --strict
```

The second command intentionally exits non-zero for the bundled synthetic fixture. Use `--strict` only after a dataset has been independently reviewed and has the required review metadata.

## No database migration in this release
No application schema changed. CI's migration run validates the existing migration chain against a disposable PostgreSQL/pgvector service; it does not add a v2.8 migration.
