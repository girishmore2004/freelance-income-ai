# Release 2.7 verification record

## Completed locally
- Python compileall for application, tests, migrations and scripts: passed.
- Focused suite: **19 passed** across RAG grounding, workflow node guards, v2.6 evaluation/operations helpers, workflow planner and hybrid retrieval.
- Offline grounding CLI ran and wrote `backend/evaluation/smoke_report.json`: 8 synthetic claims evaluated; TP=4, FP=0, TN=4, FN=0; precision/recall/F1=1.0 on this intentionally small synthetic smoke set only.
- Opt-in integration test module collected successfully: **2 skipped** because TEST_DATABASE_URL/TEST_REDIS_URL and live services/client dependencies were not provisioned.
- Updated Agent Workflows TSX syntax transpile: passed.
- Static review confirms all LangGraph stages are wrapped by the failure recorder and failure messages returned to users no longer include raw exception text.

## Full-suite limitation
A full `pytest -q` attempt could not complete collection in this packaging environment: required project dependencies `pgvector` and `langgraph` are not installed. Install `backend/requirements.txt` before running the full suite.

## Not completed / not claimed
- No live PostgreSQL/Redis/RQ integration execution in this environment.
- No migration was required for v2.7; no production migration was run.
- No LangGraph end-to-end workflow run because LangGraph is unavailable here.
- No full frontend typecheck or Next.js production build because frontend `node_modules` is unavailable.
- The grounding evaluator is lexical/heuristic, not semantic entailment. The bundled dataset is synthetic and must be expanded with human-labelled real-world examples before it is used as a quality gate.

These are local packaging checks, not a production certification.
