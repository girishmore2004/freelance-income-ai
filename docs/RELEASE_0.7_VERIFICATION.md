# Release 0.7 verification

Run:
```bash
cd backend
python -m pip install -r requirements.txt
alembic upgrade head
pytest -q
python -m compileall -q app
cd ../frontend
npm ci
npm run typecheck
npm run build
cd ..
docker compose config
docker compose build
docker compose up -d
```

Manual checks:
1. Add an RSS/Atom source and a public JSON API source.
2. Confirm source type appears in the source registry.
3. Queue discovery with Redis and the worker running.
4. Confirm both sources are read and new records are scored.
5. Add the same listing URL to two sources, including different UTM parameters.
6. Run discovery again and confirm one opportunity remains, its duplicate count increases,
   and its source-origin list contains both source types.
7. Filter opportunities by `source`, `min_score` and `fresh_days`.
8. Confirm invalid/private-host feeds are rejected and logged as errors.
9. Confirm user A cannot see user B's sources or opportunities.

## Checks performed during packaging
- All Python source files are AST-parsed.
- Pure-service tests for matching, retrieval, risk rules and canonical deduplication are run.
- API integration tests, live external feed requests, frontend production build and Docker build
  must be completed in a configured environment; static checks are not deployment proof.
