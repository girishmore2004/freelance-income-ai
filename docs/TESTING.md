# Testing and release checks

## Backend
Set `DATABASE_URL` to an isolated PostgreSQL database with the pgvector extension before running migrations. Set `TEST_DATABASE_URL` and `TEST_REDIS_URL` only when you have isolated integration-test services available.

```bash
cd backend
python -m pip install -r requirements.txt
alembic upgrade head
pytest -q
python -m compileall -q app tests scripts alembic
python scripts/evaluate_rag_grounding.py --dataset evaluation/grounding_cases.json
```

The Full CI workflow provisions PostgreSQL/pgvector and Redis, validates the migration chain, and runs the opt-in integration tests. The bundled RAG dataset is synthetic; it is not a production quality gate.

## Frontend
This repository does not include a package lockfile, so use `npm install` rather than `npm ci`.

```bash
cd frontend
npm install
npm run typecheck
npm run build
```

## Docker
```bash
docker compose config
docker compose build
docker compose up -d
curl http://localhost:8000/health
```

## Release 0.7 manual checks
- Add an RSS/Atom source and a public JSON feed.
- Queue discovery and confirm both sources are read.
- Confirm the same URL with different UTM parameters creates one opportunity and refreshes its source provenance and last-seen time.
- Confirm different users have isolated sources and opportunity records.
- Filter opportunities by source, score and freshness.
- Confirm invalid, private-host, redirecting and oversized JSON feeds fail safely.
- Confirm proposal edits invalidate prior approval and no marketplace submission occurs automatically.

Static checks and pure-service tests are not a substitute for running API integration tests, migrations against PostgreSQL, frontend production build and Docker smoke tests in the target environment.


## v3.0 production-readiness checks

- `tests/test_production_config_v30.py`: pure production environment validation.
- `tests/test_production_journey_v30.py`: FastAPI API-level proposal approval,
  stale approval, rejection, tenant isolation and workflow resume tests. The
  proposal generator and queue are replaced with deterministic test doubles;
  no external provider action is performed.
- `scripts/production_preflight.py`: configuration-only production preflight.
- `.github/workflows/full-ci.yml`: executes preflight, migration validation,
  backend suite, offline RAG/retrieval smoke benchmarks and frontend checks.

The API-level journey tests require the complete backend dependency set in
`requirements.txt`; the local build container may not have every dependency.
