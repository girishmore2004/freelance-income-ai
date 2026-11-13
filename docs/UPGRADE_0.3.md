# Release 0.3 upgrade

## Implemented in this archive
- Redis + RQ background worker for scheduled RSS discovery.
- Persistent background job status/results/errors in PostgreSQL.
- Queue API: `POST /api/v1/discovery/enqueue`, `GET /api/v1/background-jobs`.
- Worker entrypoint: `cd backend && python worker.py`.
- Portfolio document chunking with overlap.
- Optional OpenAI or Ollama embeddings.
- Vector cosine similarity ranking with lexical fallback.
- New database tables: `background_jobs`, `portfolio_chunks`.
- Alembic migration `0002_jobs_chunks`.
- Added tests for chunking, vector ranking and job list scoping.

## Run locally
`docker compose up --build` starts PostgreSQL, Redis, API, worker and frontend.
For Ollama embeddings, pull the configured embedding model:
`ollama pull nomic-embed-text`
For OpenAI embeddings, set `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY`.

## Important retrieval limitation
Embeddings are stored as JSON vectors and cosine-ranked in application code in this release. This is semantic embedding retrieval, but it is NOT pgvector-indexed database search yet. The `pgvector/pgvector` PostgreSQL image is retained for the next migration. The next release should move vector storage and ANN indexing into PostgreSQL after dimension/provider choices are fixed.

## Queue operation
RQ workers execute queued discovery jobs. If Redis is unavailable, enqueue returns HTTP 503 and the synchronous RSS import remains available. Worker status and results are persisted in the database. Do not expose Redis publicly.
