# Release 5.24.0 verification

- Focused dependency-planning tests cover longest path, parallel branches, cycle reporting, unknown effort, archived projects and date-overlap warnings.
- Python compilation is required before packaging.
- ZIP CRC and SHA-256 manifest are verified by `ops/package_release.py`.
- Frontend production build and live database migration must be verified in the deployment environment; do not infer these from unit tests.
