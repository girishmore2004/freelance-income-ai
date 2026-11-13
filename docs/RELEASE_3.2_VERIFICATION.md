# Release 3.2 verification record

## Changes included

- Added cross-account isolation API regression tests for opportunities, projects, invoices, tasks, milestones and client research. Tests include list visibility, direct reads, update attempts and cross-account parent-child creation.
- Added a Playwright authenticated login journey using mocked API responses. The suite now checks both rejected and successful login UI behavior.
- Added Python and production npm dependency audit jobs to GitHub Actions.
- Added a read-only k6 health smoke profile and controlled load-testing guidance.
- Added a human-reviewed retrieval benchmark protocol that separates synthetic smoke fixtures from authorized human-labelled evaluation data.
- Updated release metadata to 3.2.0.

## Verification in this package build

- Python `compileall` passed for the backend source tree, including the new tenant-isolation test module.
- Shell syntax checks passed for the backup and restore scripts.
- GitHub Actions workflow YAML parsed successfully and contains backend, frontend, browser E2E and dependency-security jobs.
- Focused deterministic service tests: 23 passed.
- The new tenant-isolation API test was attempted but could not be collected because `pgvector` is not installed in this build environment. It must run in CI after installing `backend/requirements.txt`.
- Playwright, dependency audits, full backend integration, frontend typecheck/build, k6 against staging and live restore drill have not been executed here.
- Final archive CRC and all manifest SHA-256 entries are checked before release packaging.

## Not claimed as completed

- The new API tenant-isolation tests require the full backend dependencies and an isolated test database; they are included but are not claimed as executed in this package build.
- Playwright requires npm dependencies and Chromium; execution is delegated to GitHub Actions or a configured local environment.
- Dependency audit results are not known until CI installs and audits the pinned dependencies. Any vulnerability finding must be resolved before deployment.
- No human-reviewed retrieval dataset was invented or evaluated. The protocol is provided; a real authorized dataset and reviewer sign-off are still required.
- No k6 load test against a real staging service has been run.
- No distributed rate limiter, production security audit, penetration test or capacity certification is included.
- PostgreSQL/Redis full integration and live Render/Vercel deployment remain external verification steps.

No database migration is included. All external client actions remain human-approved; this release does not add marketplace scraping, automatic proposal submission, automatic email sending or payment execution.
