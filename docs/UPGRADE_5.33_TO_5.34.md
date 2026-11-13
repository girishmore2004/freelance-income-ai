# Upgrade v5.33.0 → v5.34.0

1. Back up PostgreSQL and retain the backup off-host.
2. Deploy the source files from v5.34.0.
3. Run `cd backend && alembic upgrade head`.
4. Restart the API and frontend.
5. Open Delivery & Finance Workspace, choose a project and deliverable, then create a delivery issue against an exact saved revision.
6. Triage, assign and record corrective action. Resolve only after entering a resolution summary and evidence reference; close only after resolution.

Migration `0038_delivery_issue_workflow` adds a new table and indexes; it does not rewrite historical delivery audit records. Do not reset or drop the existing database.

No client email, marketplace message, contract modification, invoice issue or payment is triggered by issue management.
