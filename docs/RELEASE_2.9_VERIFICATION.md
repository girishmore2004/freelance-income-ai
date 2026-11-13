# Release 2.9 verification record

## Completed in the build environment

- Python `compileall` completed successfully for application, tests, scripts and Alembic sources.
- Focused pytest suite: 13 passed. Covered new retrieval dataset/metric tests, approval policy tests, and existing retrieval/RAG evaluation tests.
- Retrieval benchmark CLI completed against the synthetic three-query fixture.
- Existing RAG grounding smoke CLI completed against the v2.8 synthetic fixture.
- Release metadata agrees at `VERSION`, FastAPI app version and frontend package version: 2.9.0.
- Source review confirms the exact-content approval helper is used by approval decision, mark-ready and workflow resume.
- No Alembic migration was added.

## Not verified in this environment

- Full backend test suite and live PostgreSQL/pgvector/Redis/RQ integration.
- Frontend TypeScript typecheck and Next.js production build.
- Browser E2E for the full proposal approval journey.
- Human-reviewed production RAG/retrieval benchmark and semantic entailment.
- Production deployment and external provider actions.

The synthetic retrieval fixture returns hit-rate=1.0, precision@5=0.2, precision among returned=1.0, recall@5=1.0, MRR@5=1.0 and nDCG@5=1.0. The deliberately simple examples return only one relevant chunk per query; the Precision@5 value correctly uses k=5 as its denominator. This confirms the evaluator runs, not production retrieval quality.
