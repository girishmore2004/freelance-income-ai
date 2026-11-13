# v5.37.0 verification

- Added deterministic snapshot builder and fingerprint/hash helpers.
- Added project-scoped snapshot create/list endpoints, explicit stale-input-checked approval, and approved-only JSON export.
- Added Delivery & Finance Workspace UI for preview, approval and local export.
- Added regression tests for evidence/unknown handling and snapshot hash/fingerprint behavior.
- Full database migration and frontend production build must be run in the deployment CI environment with project dependencies installed.
