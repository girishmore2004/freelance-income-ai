# Upgrade 2.6 → 2.7

1. Back up the repository and database.
2. Apply v2.7 source files on top of v2.6; this release adds no database migration.
3. Install the existing pinned backend requirements.
4. Run the offline grounding evaluation and focused tests.
5. Optionally start local PostgreSQL/Redis and run the opt-in integration tests using `docs/RELEASE_2.7_RAG_RELIABILITY.md`.
6. Redeploy the API and frontend. Restart the RQ worker so it uses the updated graph-node wrappers.
7. Inspect `error_code` and `last_error_node` for any failed workflow.

No new paid API key or model is required for the offline evaluator. The current claim support evaluator is a heuristic and must not be treated as a semantic judge.
