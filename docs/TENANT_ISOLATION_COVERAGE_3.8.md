# Tenant isolation coverage — 3.8

## Added route-level tests
- Deliverable creation and project deliverable listing across account boundaries.
- Time entry creation against another account's project.
- Invoice schedule creation against another account's project.
- Email intake linked to another account's project.
- Follow-up reminder creation referencing another account's email or project.
- Portfolio document listing and retrieval isolation, including search results.

The tests use two separately authenticated accounts and verify that cross-account references are rejected or invisible.

## Existing coverage
The prior tenant suite already covers opportunities, projects, invoices, tasks, milestones and client research. Agent workflow owner-boundary tests were added in v3.7.

## Still requiring explicit route-level coverage
- OAuth state and provider account lifecycle.
- Marketplace connection and application detail/mutation routes.
- Deliverable revision access and invoice schedule approval/issue lifecycle.
- Workflow checkpoint API access across all workflow types.
- PostgreSQL row-level/constraint behavior under concurrent requests.

## Verification boundary
SQLite-backed TestClient tests are useful regression coverage but do not prove PostgreSQL isolation, multi-worker correctness, or security certification. Live Redis, browser E2E, frontend build, dependency audit, k6 and backup/restore remain separate CI/staging tasks.
