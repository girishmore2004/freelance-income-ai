# Release 5.25.0 verification

- Focused tests cover weekday capacity allocation, dependency order, calendar blocks, projected lateness, missing predecessor effort, dependency cycles, milestone risk and closed-task exclusion.
- Python compilation is required before packaging.
- ZIP CRC and SHA-256 manifest are verified by `ops/package_release.py`.
- No migration or new dependency is introduced.
- Frontend production build, live API integration and browser end-to-end checks must be run in the deployment environment; do not infer them from backend unit tests.
