# Release 2.3 Verification

## Passed
- Focused retrieval suite: 10 tests passed (`test_retrieval.py`, `test_hybrid_retrieval.py`, `test_retrieval_eval.py`, `test_retrieval_v23.py`).
- Python compileall: passed for backend application and tests.
- ZIP integrity: verified during packaging.
- SHA-256 manifest: every packaged project file verified.

## Not passed / not run
- Full backend suite: collection is blocked by missing `pgvector` and `langgraph` packages in this environment. This is an environment limitation, not a passing test.
- FastAPI startup and live PostgreSQL/pgvector query: not verified.
- Frontend typecheck and production build: not run.
- Ollama/OpenAI embeddings and generation: not live-tested.
- Render/Vercel deployment and browser end-to-end tests: not run.

## Security and behavior
- No schema migration is required.
- No new paid service is required.
- Retrieval falls back to lexical ranking if query embeddings are unavailable.
- Citation validation checks source IDs only; it does not prove semantic entailment.
- External actions remain outside this retrieval upgrade and continue to require existing approval flows.
