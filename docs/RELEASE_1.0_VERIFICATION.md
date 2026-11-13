# Release 1.0 verification

## Focused test suite
```bash
cd backend
pytest -q tests/test_opportunity_ranking.py tests/test_source_health.py \
  tests/test_client_risk.py tests/test_scoring.py tests/test_scoring_v05.py \
  tests/test_hybrid_retrieval.py tests/test_retrieval.py tests/test_retrieval_eval.py \
  tests/test_specialists.py tests/test_discovery_service.py tests/test_json_connector.py \
  tests/test_agent_package_exports.py
```

## API integration check
After installing all backend requirements and configuring a test database:
1. Register two test users.
2. Create opportunities in both accounts.
3. Add won/lost feedback against opportunities in the first account.
4. Call `GET /api/v1/opportunities/ranked` as the first user.
5. Verify only that user's opportunities appear.
6. Verify ranking component values sum to `rank_score`.
7. Verify only feedback in matching industry or work type contributes to the prior.
8. Call with `limit`, `offset` and `source` and verify filters.

## Frontend
```bash
cd frontend
npm ci
npm run typecheck
npm run build
```
In Opportunities, click Smart rank opportunities, inspect reasons/sample counts, then click Recent order to return to the normal listing.

## Deployment
```bash
docker compose config
docker compose build
docker compose up -d
```
No schema migration is required for v1.0. The ranking endpoint is computed from existing opportunity and feedback data.

## Verification performed while packaging
- Python AST parsing: all source files checked.
- JSON files and Docker Compose YAML: checked.
- Focused automated tests: 31 passed.
- TypeScript parser diagnostics: zero.
- Full TypeScript typecheck did not complete because frontend dependencies/types are not installed in the packaging environment.
- Full API integration tests, frontend production build and Docker image build were not run here.
