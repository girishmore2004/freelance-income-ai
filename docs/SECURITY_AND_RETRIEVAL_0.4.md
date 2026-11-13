# Release 0.4 — retrieval and ingestion hardening

## What's new
- Native PostgreSQL `pgvector` column for portfolio chunks.
- PostgreSQL cosine-distance ranking for vector-backed chunks.
- SQLite and lexical/JSON fallback remain available for local development.
- Migration backfills v0.3 JSON embeddings into pgvector when possible.
- Retrieval evaluation helper reports Recall@K and MRR@K.
- Fixed requirements-file newline packaging and updated app version to 0.4.0.

## Migration
The API container already runs `alembic upgrade head` at startup.

For a manual deployment:
```bash
cd backend
alembic upgrade head
```

For Docker:
```bash
docker compose down
docker compose build --no-cache api worker
docker compose up -d
docker compose logs -f api worker
```

## Embedding compatibility
The embedding model used for new documents and search queries must remain the same
and must return a consistent vector dimension. If you change the model, re-embed
existing documents. The API falls back to lexical/JSON retrieval if vector search
cannot run, but this fallback should be treated as degraded mode.

## Current limitations
- This release uses exact cosine ranking through pgvector; it does not create an
  approximate HNSW index because the project currently permits configurable
  embedding dimensions/models. Configure one fixed embedding model and dimension
  before adding a dimension-specific ANN index.
- OCR, malware scanning, private object storage, OAuth email integrations,
  marketplace submission APIs, and durable LangGraph checkpoint/resume remain
  planned work. No marketplace action is performed automatically.
- A successful Python syntax check does not replace installing dependencies,
  running pytest, building Docker images, or testing against a real PostgreSQL
  + pgvector instance.
