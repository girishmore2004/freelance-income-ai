# Upgrade v5.30.0 → v5.31.0

1. Back up the production database.
2. Deploy the source archive and install the existing pinned backend dependencies.
3. Run `alembic upgrade head` from the backend environment.
4. Deploy the frontend.
5. Verify `GET /api/v1/analytics/delivery-quality?minimum_sample=3` and create a test revision in a non-production project.

Migration `0035_deliverable_revision_origin` adds `revision_origin`, `origin_note`, and `origin_evidence_reference` to `deliverable_revisions`. Existing version 1 snapshots are marked `initial`; all other historical revisions are `unclassified`. No historical origin is guessed.

For new revisions, choose an origin in the Delivery workspace. `client_requested` and `approved_scope_change` require an explanation and evidence reference. These are user-recorded labels, not independently verified client attestations.

No client message, external application, contract acceptance, invoice issuance or payment action is triggered by this upgrade.
