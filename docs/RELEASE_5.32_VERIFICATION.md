# v5.32.0 Release verification

- Added nullable foreign-key links from revision snapshots to client feedback events and approved scope-change requests.
- Validates ownership and entity scope before recording links. Client feedback must be a changes-requested event for the same deliverable, current revision and matching content hash. Scope change must be approved and explicitly client-accepted for the same project.
- Foreign keys use RESTRICT; linked evidence records cannot be deleted while referenced. No revision update/delete endpoint was added.
- Historical rows remain unlinked.
- Backend unit and source-contract tests are listed in the release handoff.
- Frontend production build and live PostgreSQL migration execution must be verified in the deployment environment; this workspace does not have the full dependency/database environment.
