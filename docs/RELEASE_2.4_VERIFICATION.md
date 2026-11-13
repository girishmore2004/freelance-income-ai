# Release 2.4 Verification

## Passed in the packaging environment
- Python `compileall` passed across backend application, tests and Alembic migration files.
- Focused pure business-planner policy tests: 3 passed.
- Alembic migration `0019_durable_agent_workflows` SQLite upgrade/downgrade smoke test passed.
- Workflow API, engine, model and migration source files passed Python syntax compilation.
- ZIP integrity and SHA-256 manifest are checked again during final packaging.

## Blocked or not run
- LangGraph workflow graph tests could not be collected because `langgraph` is not installed in this packaging environment. It is declared in `backend/requirements.txt`.
- Full backend test suite and FastAPI startup were not run; `pgvector` and `langgraph` are absent from this environment.
- Full frontend typecheck/build was not run because frontend dependencies (`node_modules`) are not installed. TypeScript/TSX syntax is checked separately where the compiler is available.
- Live PostgreSQL migration, Redis/RQ execution, worker crash recovery, multi-process idempotency and retry behavior were not integration-tested.
- Render/Vercel deployment and browser end-to-end tests were not run.

## Operational and safety limits
- Background execution requires the existing Redis/RQ service and worker.
- Three total attempts are allowed. A run still marked `running` for more than 20 minutes can be retried from its last committed checkpoint.
- The workflow is read-only. It does not send email, submit proposals, deliver files, issue invoices or move money.
- Research summaries reflect saved confidence labels and URLs; they are not independent verification.
- Finance totals are not converted across currencies.
- Checkpoints contain user-derived account snapshots; protect database backups and restrict access.
