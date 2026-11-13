# Upgrade 4.0.0 → 4.1.0

## Release scope
This release continues the existing application architecture. It does not rebuild the system, change database tables, or add environment variables.

## Changes
- Lifecycle API regression suite covering marketplace application approval and audit, invoice schedule approval/issue, deliverable review/handover/acceptance, and durable workflow resume.
- Row-level locking on selected marketplace and deliverable mutation paths to reduce conflicting concurrent state transitions on databases that support `SELECT FOR UPDATE`.
- Backend test configuration now selects the isolated `TEST_DATABASE_URL` in non-production environments when supplied. Production always uses the normal configured database URL.
- Version metadata updated to 4.1.0.

## Upgrade steps
1. Back up the repository and database.
2. Merge/extract this ZIP over the existing repository; preserve `.git`, `.env`, secrets and deployment configuration.
3. No Alembic migration is required.
4. Install the backend requirements and run `cd backend && pytest -q`.
5. Review the GitHub Actions full-CI result, including PostgreSQL/pgvector, Redis, frontend and dependency security jobs.
6. Push the reviewed changes to your configured deployment branch.

## Human-control boundary
Marketplace submission remains a user action performed on the marketplace itself; the application endpoint only records that the user says it was submitted. Invoice issuance creates an unpaid invoice record only and does not send it or request payment. Deliverable delivery is recorded only after the user performs the actual handover. No email is sent, no marketplace application is submitted, and no payment is initiated by this release.
