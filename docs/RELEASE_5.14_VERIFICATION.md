# v5.14.0 release verification

- Focused regression tests: 31 passed across v5.14 through v5.9/retrieval tests.
- Backend Python compilation: passed.
- No database migration and no new runtime dependency.
- Frontend package/build not run in this environment; run `npm ci`, `npm run typecheck`, and `npm run build` in CI.
- PostgreSQL integration and browser E2E not run.
- Outcome analysis uses latest manually recorded feedback and proposal per opportunity; no marketplace outcomes are inferred.
- Win rates are hidden below the configured minimum decided sample. Small-sample descriptive rates, when present, are not inferential.
