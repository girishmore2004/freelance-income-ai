# Release v5.31.0 verification

## Implemented
- Added explicit revision-origin metadata: `client_requested`, `internal_improvement`, `approved_scope_change`, `other`, `unclassified`, and `initial`.
- Added origin explanation and evidence-reference fields.
- New client-requested and approved-scope-change classifications require a meaningful explanation and evidence reference.
- Initial snapshots are marked `initial`; historical non-initial revisions migrate to `unclassified`.
- Delivery workspace captures origin at revision creation; analytics displays per-deliverable and per-project origin counts.
- Revision-origin analytics uses only explicit stored classifications; no temporal or free-text inference is performed.
- Added Alembic migration `0035_deliverable_revision_origin`.

## Verification
- Focused backend regression suite spanning v5.9–v5.31: **90 passed**.
- Python compilation (`compileall`): **passed**.
- Release packager tests: **2 passed**.
- ZIP CRC, manifest and SHA-256 verification: performed during packaging.

## Environment limitations
- Alembic migration graph execution could not be run in this environment because the installed Python environment is missing `pgvector`, imported by the existing application model module. The migration file and parent revision were inspected; production must run `alembic upgrade head` after backup.
- Frontend production build/typecheck could not be run because `frontend/node_modules` is not installed.
- No live database or production deployment was modified.

## Safety and interpretation
- Origin labels are entered by the workspace owner and are not independently verified client attestations.
- Historical revisions remain unclassified unless users have actual evidence and classify them through a future controlled workflow.
- No client communication, marketplace application, contract acceptance, invoice issuance or payment action is performed.
