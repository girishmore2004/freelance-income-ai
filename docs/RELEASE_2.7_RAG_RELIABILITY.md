# Release 2.7 — RAG Quality & Agent Reliability

## Implemented
- Offline claim-to-evidence grounding evaluator with transparent token coverage, exact numeric mismatch and negation conflict checks.
- Citation ID precision, recall and F1 from v2.6 retained.
- Synthetic labelled smoke dataset at `backend/evaluation/grounding_cases.json`.
- CLI runner at `backend/scripts/evaluate_rag_grounding.py`.
- Agent graph nodes are wrapped with failure telemetry. A failing node records a stable error code, its node name and a bounded error message before the workflow-level failure handler runs.
- Guard-node tests prove original exceptions survive telemetry failures.
- Opt-in PostgreSQL connectivity/transaction test and Redis/RQ enqueue/delete test, guarded by environment variables.
- Docker Compose exposes PostgreSQL and Redis only on loopback for local integration testing.

## Important evaluation limitation
The claim support score is a deterministic lexical proxy, not semantic entailment. It catches exact numeric conflicts and a small set of negation/scope patterns, but it can miss paraphrases, subtle contradictions, temporal qualifiers and context-dependent meaning. The bundled eight-claim dataset is synthetic smoke data and its perfect score is not evidence of production accuracy. Add human-reviewed examples from real, consented documents before using thresholds for release decisions.

## Run RAG evaluation
From `backend/`:
```bash
python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json
```
Optional JSON output:
```bash
python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json --output evaluation/latest_report.json
```

## Run unit tests
From `backend/`:
```bash
pytest -q
```

## Run real service integration tests
Start isolated local services from the repository root:
```bash
docker compose up -d db redis
```
Then from `backend/`:
```bash
TEST_DATABASE_URL=postgresql+psycopg://freelance:freelance_dev_password@localhost:5432/freelance_ai TEST_REDIS_URL=redis://localhost:6379/0 pytest -m integration -q
```
These tests check PostgreSQL connectivity/transaction rollback and Redis/RQ enqueue lifecycle. They do not run migrations or execute a full background workflow. For a clean test database, apply migrations separately:
```bash
DATABASE_URL=postgresql+psycopg://freelance:freelance_dev_password@localhost:5432/freelance_ai alembic upgrade head
```

## Safety
No external action has been enabled. Workflow recommendations, proposal previews and communication plans remain review-only.

## Agent failure handling
Each graph node is wrapped by a failure recorder. When a node fails, the workflow stores its stage and stable error code before the exception is propagated to the workflow handler. User-facing error messages are generic and do not return raw exception strings, which may contain connection details. Check server-side logs using the workflow ID for deeper diagnostics.
