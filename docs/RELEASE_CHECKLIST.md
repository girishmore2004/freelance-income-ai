# Release 2.8 verification and deployment checklist

## Checks completed in this archive preparation environment
- Python compilation for application, tests, scripts and Alembic migrations: PASS.
- Focused test suite: **24 passed**.
- Offline RAG dataset structure validation and smoke evaluation: PASS (8 synthetic claims).
- Unknown citation IDs are rejected in claim support; focused regression test: PASS.
- Strict mode rejects the bundled synthetic dataset as a production benchmark: PASS (expected exit code 3).
- GitHub Actions workflow YAML and frontend package JSON parse: PASS.
- ZIP CRC, source manifest and SHA-256 manifest are validated during packaging.

## Checks not completed in this environment
- Full backend pytest collection: BLOCKED because `langgraph` and `pgvector` are not installed. Installing dependencies was attempted, but network/DNS access to the package index was unavailable.
- Live PostgreSQL/pgvector migration and Redis/RQ integration: NOT RUN locally. The Full CI workflow now provisions disposable services and runs these checks.
- Frontend typecheck and Next.js production build: NOT RUN locally because frontend dependencies are not installed and network access is unavailable. Full CI is configured to run them.
- Browser E2E approval/workflow tests: NOT INCLUDED in v2.8; tracked for v2.9.
- Live Ollama/OpenAI, OAuth provider, Telegram, n8n, Render, Vercel and marketplace integrations: NOT RUN.

## Before production use
1. Require a green GitHub Full CI run on the exact commit being deployed.
2. Deploy to staging first and verify `/health`, login, tenant data isolation, proposal editing/approval invalidation, workflow pause/resume/cancel and document retrieval.
3. Verify secrets and OAuth redirect URIs in the hosting provider; never commit `.env`.
4. Confirm backups and a tested restore path for PostgreSQL.
5. Review `docs/SECURITY.md` and provider terms.
6. Confirm that outbound email, marketplace submission, client delivery and financial actions still require explicit human approval.

Do not describe this release as production-certified based only on local checks or synthetic RAG metrics.
