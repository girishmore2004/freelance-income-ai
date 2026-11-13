# v5.13.0 release verification

- Synthetic fixture count: 8.
- Benchmark validates duplicate IDs and empty datasets.
- Focused regression tests run before packaging; see release handoff for exact results.
- No database migration and no new runtime dependency.
- Full backend/PostgreSQL integration and frontend build must be run in the deployment CI environment.
- Dataset is synthetic and not human-reviewed. Reported metrics must not be generalized to real proposal outcomes.
