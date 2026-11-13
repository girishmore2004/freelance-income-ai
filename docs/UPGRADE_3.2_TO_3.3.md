# Upgrade 3.2 → 3.3

1. Back up PostgreSQL and preserve your current `.env` and deployment settings.
2. Extract the v3.3 source over your existing repository; preserve `.git`.
3. Add the three `RATE_LIMIT_*_PER_MINUTE` settings from `.env.example` to Render. Defaults are 120 general, 10 authentication and 30 AI requests per actor per minute.
4. Confirm `REDIS_URL` points to a reachable Redis instance. Production rate limiting fails closed with 503 if Redis is unavailable.
5. Run `cd backend && pytest -q`.
6. Run `cd frontend && npm install && npm run typecheck && npm run build && npx playwright install chromium && npm run test:e2e`.
7. Review all CI jobs, including dependency audits. Resolve audit findings before deployment.
8. Check `GET /health` and `GET /ready` after deploying the API.
9. Run controlled k6 tests against staging only, and inspect 429/503 rates before raising limits.

No Alembic migration is included in 3.3.
