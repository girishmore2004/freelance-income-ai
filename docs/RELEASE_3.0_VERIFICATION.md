# Release 3.0 verification record

## Completed in this build environment

- Python compileall passed for backend application, tests, scripts and migrations.
- Focused pure-Python tests: 23 passed. These cover production configuration,
  approval policy, retrieval benchmark evaluation and RAG grounding evaluation.
- Production preflight CLI passed using non-secret CI-style environment values.
- CI workflow YAML parsed successfully.
- JSON package and benchmark metadata will be revalidated in the final archive.
- No Alembic migration was added.

## Added but not executed here

- API-level proposal lifecycle tests in `test_production_journey_v30.py`.
  This build environment does not have `pgvector` (and several other backend
  requirements) installed, so importing the full FastAPI application fails
  during test collection. The full CI job installs `backend/requirements.txt`
  and runs the complete pytest suite against its configured test services.
- PostgreSQL migration execution and Redis/RQ integration.
- Frontend typecheck and Next.js production build.
- Browser automation, production deployment, backup/restore and load tests.

Do not interpret compilation or the 20 focused pure-Python tests as a full
production certification. Review the GitHub Actions run after pushing this
release and resolve any failing integration or frontend jobs before deployment.
