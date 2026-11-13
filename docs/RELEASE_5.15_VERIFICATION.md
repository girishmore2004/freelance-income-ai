# v5.15.0 release verification

- Focused regression tests: 34 passed (source ROI, proposal outcome intelligence, proposal quality/claims/evidence, ranking and retrieval).
- Backend Python compilation: run during packaging handoff.
- ZIP CRC and manifest hashes: verified after packaging.
- No database migration and no new runtime dependency.
- Frontend typecheck/build, PostgreSQL integration and browser E2E are not verified in this environment.
- ROI is partial attributed project ROI, not full business profit. No cross-currency conversion or client-overhead allocation is attempted.
