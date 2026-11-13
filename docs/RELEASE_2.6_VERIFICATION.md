# Release 2.6 verification record

## Checks completed in the packaging environment
- `python -m compileall -q app tests alembic/versions`: passed (exit code 0).
- Focused pytest suite: **9 passed** (`test_workflow_operations_v26.py`, `test_rag_evaluation_v26.py`, `test_agent_workflow_planner.py`).
- TypeScript transpile syntax check for the updated Agent Workflows page: passed.
- Static source assertions: cancellation endpoint, dry-run retention default, terminal-only cleanup, cancelled-worker guard, attempt fencing and read-only external-action policy all present.
- Migration file syntax/revision linkage: checked statically.
- ZIP CRC and SHA-256 manifest: performed after packaging.

## Checks not completed
- Alembic `history`/`heads` could not load the project migration environment because `pgvector` is not installed in this packaging environment. Install all `backend/requirements.txt` dependencies before running `alembic upgrade head`.
- LangGraph is not installed in this packaging environment, so no live LangGraph graph execution or full workflow engine test was run.
- Frontend `node_modules` is absent. TSX transpile syntax passed, but full TypeScript typecheck and Next.js production build were not run.
- No provisioned PostgreSQL, Redis/RQ worker, Ollama/OpenAI endpoint or browser was available. Database migration execution, queue cancellation under concurrency, model quality, and browser E2E are not certified.
- The RAG metric tests evaluate evidence-ID overlap only. No human-labelled production benchmark or semantic entailment evaluation is included.

These results are local packaging checks, not a production certification.
