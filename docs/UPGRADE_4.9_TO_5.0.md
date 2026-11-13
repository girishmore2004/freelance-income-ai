# Upgrade Freelance Income AI 4.9.0 → 5.0.0

## What changes

- Adds immutable `client_contract_revisions` snapshots. Creating a contract creates revision 1; subsequent edits create a new snapshot, preserve the prior hash, increment the version and reset the current contract to `draft` so the new terms require a fresh manual send/acceptance cycle.
- Adds a revision-chain verification result to `GET /api/v1/client-contracts/{contract_id}/revisions` (`chain_valid` plus ordered `revisions`). The chain detects missing versions or changed parent hashes; it is an integrity check, not a cryptographic signature or tamper-proof external ledger.
- Adds `deliverable_acceptance_events`, recording each client acceptance or change request against the current deliverable revision and content hash. `GET /api/v1/deliverables/{deliverable_id}/acceptance-history` returns the history.
- Backfills the latest available contract snapshot for existing contracts and copies existing client acceptance/change-request delivery audit events into the new history table. Older contract versions that were never stored cannot be reconstructed; historical acceptance entries are labelled as migrated and have no separately captured evidence.

## Deployment

1. Back up PostgreSQL and verify the backup.
2. Extract the release over the existing repository. Preserve `.git`, `.env`, provider credentials and deployment configuration.
3. Run backend checks and review the generated migration.
4. Deploy the API code and run the migration once from the backend release environment:

   ```bash
   cd backend
   alembic upgrade head
   ```

5. Deploy the frontend from the same commit.
6. Verify contract revision history and deliverable acceptance history using an account with existing client/project records.

Do not run migrations concurrently from multiple API replicas. A downgrade drops the two new history tables and therefore destroys revision/acceptance history created after upgrade; prefer application rollback without database downgrade unless the data is disposable and a verified backup exists.

## Human approval boundaries

No contract is emailed, signed, delivered or accepted automatically. Contract acceptance remains an account-owner record of written evidence. Deliverable client-status entries are also owner-recorded history, not verified client identity or a legally binding e-signature.
