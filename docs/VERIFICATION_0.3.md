# Release 0.3 verification report

## Checks performed in the packaging environment
- Parsed all Python files with `ast.parse`: PASS (38 Python files).
- Parsed all JSON files: PASS (5 JSON files).
- Parsed `docker-compose.yml`: PASS.
- Verified Compose service declarations: db, redis, api, worker, web.
- Verified backend image copies the RQ worker entrypoint: PASS.
- Verified Redis and RQ dependencies are declared: PASS.
- Verified Alembic migration 0002 exists: PASS.
- Verified discovery queue and portfolio chunk retrieval endpoints are present: PASS.
- ZIP integrity is checked after archive creation.

## Checks not completed
- Pytest could not collect the API tests because the packaging environment does not have `python-jose` installed. This is a missing environment dependency, not a passing test result.
- Full dependency installation was not completed.
- Docker image build and container startup were not executed.
- Frontend `tsc` and production build were not executed.
- No live RSS provider, Ollama instance, OpenAI key, Telegram bot or hosted deployment was available for integration testing.

## Release limitations
- Embeddings are stored as JSON vectors and cosine-ranked in Python. This release does not yet use pgvector indexes.
- The queue runs through Redis/RQ; a running worker is required.
- Outreach remains disabled; human approval does not send a marketplace application.
- RSS ingestion is the only automated discovery connector in this release.
- Ollama/OpenAI embeddings are optional; lexical fallback remains available.
