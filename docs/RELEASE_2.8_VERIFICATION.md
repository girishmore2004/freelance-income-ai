# Release 2.8 verification record

## Intended checks
- Python compileall for backend app, tests, scripts and Alembic migrations.
- Focused tests for citation integrity, benchmark schema validation, workflow guards and retrieval helpers.
- RAG CLI structural validation and smoke run.
- ZIP CRC and SHA-256 manifest validation.
- CI configuration includes PostgreSQL/pgvector, Redis/RQ, migration execution, backend tests, frontend typecheck and Next.js build.

## Environment-dependent checks
- The GitHub Actions workflow is configured to execute live PostgreSQL/pgvector migrations and Redis/RQ integration tests. A local packaging run without those services cannot claim these checks passed.
- Full frontend typecheck/build requires Node.js dependencies to be installed.
- No browser E2E suite is included in this release.

## Quality limitations
- Grounding uses lexical overlap, numeric and negation checks, plus citation-ID integrity. It is not semantic entailment.
- Bundled RAG cases are synthetic smoke fixtures, not a representative human-reviewed benchmark.
- Passing local tests is not production certification. Validate with real account data in a staging environment before production rollout.
