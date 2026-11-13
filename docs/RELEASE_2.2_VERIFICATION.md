# Release 2.2 Verification

## Scope

Verification for the deterministic action planner added in release 2.2.

## Checks to run

```bash
cd backend
pytest -q tests/test_action_planner.py
python -m compileall -q app
```

Frontend checks:

```bash
cd frontend
npm ci
npm run typecheck
npm run build
```

## Important

A successful unit test does not prove production API/database behavior. Run the full backend test suite against the configured PostgreSQL environment and exercise `/agent` in a browser after deployment. OAuth provider flows, marketplace APIs, Redis workers, and external delivery/payment operations are not newly tested by this release.
