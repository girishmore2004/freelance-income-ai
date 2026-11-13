# Release 3.1 verification record

## Added

- Playwright browser regression tests for landing-page controls, rejected-login feedback, and unauthenticated route guards.
- CI job installs Chromium and runs the browser regression suite.
- Standard-library API health probe for the existing `/health` endpoint.
- PostgreSQL custom-format backup and guarded restore scripts with checksum generation/verification workflow.
- Upgrade, operations and release-scope documentation.
- Version metadata updated to 3.1.0.

## Verification status in this package build

- Source and configuration changes reviewed for consistency.
- Python syntax compilation, shell syntax checks, JSON parsing, YAML parsing, archive CRC and manifest integrity are part of package verification.
- Playwright execution requires npm packages and Chromium; it must be run by GitHub Actions or a machine with network access.
- Full backend PostgreSQL/pgvector and Redis integration tests, frontend typecheck/build, live deployment, backup creation against a real database, and restore drill are not claimed as completed here.
- The browser suite does not authenticate against a real backend; it tests UI behavior with a mocked failed login and no-token route guards.

Do not interpret these tests as production certification or an independent security audit. Review every GitHub Actions job after pushing and complete a staging restore drill before relying on the backup procedure.
