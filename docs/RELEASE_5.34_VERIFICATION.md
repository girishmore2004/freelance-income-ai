# v5.34.0 Verification

- Added delivery issue/corrective-action model and migration `0038_delivery_issue_workflow`.
- Added user-scoped list/create/update/audit endpoints. Creation validates that the selected revision belongs to the selected deliverable and project. Optional feedback must be an exact change-request event for that revision and hash.
- Issue creation and update append to the project's hash-chained delivery audit.
- Closed issues cannot be edited. Resolution and closure require corrective action, resolution note and evidence reference.
- Added delivery workspace controls and exact revision selector.
- Automated tests cover transition policy, evidence gates, terminal closure, reopen behavior and severity validation.

Environment-specific checks (Alembic execution against PostgreSQL and frontend production build) must be run in the fully provisioned deployment environment if unavailable in the release builder.
