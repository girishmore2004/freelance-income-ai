# Upgrade 2.7 to 2.8

## Scope
This is a source-code and CI upgrade. No application database migration is required.

## Steps
1. Back up the current repository and database as a normal release precaution.
2. Replace the deployed source with the v2.8 repository contents, or merge the v2.8 commit into your existing branch.
3. Keep existing environment variables and secrets; do not commit `.env` files.
4. In the backend environment, install the pinned requirements: `pip install -r requirements.txt`.
5. Run the offline RAG evaluation from `backend/`: `python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json`.
6. Run backend tests: `pytest -q`.
7. Run frontend checks from `frontend/`: `npm install`, `npm run typecheck`, `npm run build`.
8. Push to GitHub. The Full CI workflow validates PostgreSQL/pgvector migrations, Redis/RQ integration, backend tests, the RAG smoke evaluator and frontend build.
9. Deploy backend and frontend using the existing Render/Vercel service configuration. Verify `/health`, login, workflows, proposal approvals and dashboards.

## Notes
- Existing RAG scores are heuristic, not semantic entailment scores.
- The bundled fixture is synthetic. Add independently reviewed examples before using `--strict`.
- All external messages, proposal submissions, client deliveries and financial actions remain behind existing explicit human approval paths.
