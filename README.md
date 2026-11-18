# Freelance Income AI — Edge API branch

This branch holds only the live backend: the Cloudflare Worker in
`backend/edge-api` (Worker `freelance-income-ai-api-edge`, built by Cloudflare
Workers Builds with root directory `backend/edge-api`).

- Frontend, database migrations, Python reference code and project records live on `main`.
- CI for this branch: `.github/workflows/edge-api-ci.yml` (typecheck, tests, deploy dry run).
- The older full copy of the project that used to sit on this branch was removed on
  2026-11-18; it is still in git history.
