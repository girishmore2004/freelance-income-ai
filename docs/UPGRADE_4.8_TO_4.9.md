# Upgrade v4.8.0 to v4.9.0

## Scope
This additive release extends the client CRM with contract/SOW records, a manual communication timeline and client-level profitability summaries. Existing projects, invoices, time entries, deliverables and scope-change data are preserved.

## Database migration
Alembic revision `0023_client_ops` follows `0022_client_crm_scope`. It creates:
- `client_contracts`: client/project-linked contract and SOW documents, content SHA-256 fingerprint, lifecycle state, currency/value and expiry date.
- `client_communication_logs`: client/project-linked manual call, meeting, message, email-note and internal-note timeline records.

Back up PostgreSQL, then run the migration exactly once:

```bash
cd backend
alembic upgrade head
```

Do not run migrations concurrently from API replicas. The migration is additive. Downgrade drops the two new tables and therefore deletes their records; prefer application rollback without downgrade unless data is disposable and a verified backup exists.

## Application features
- `/clients` now includes contract/SOW draft creation, review, status recording, communication logging and client profitability summaries.
- Contract content is fingerprinted. Decisions reject stale content hashes.
- Contract lifecycle: `draft -> sent -> accepted|rejected|expired`, with archive allowed from draft or sent. Terminal states cannot be reopened through the decision endpoint.
- Acceptance requires a written-evidence reference of at least 10 characters. This is an account-owner attestation, not a cryptographic signature or independently verified client action.
- Marking a contract as sent only records the status. No email or document is sent.
- Communication entries are manually entered and do not send messages.
- Profitability aggregates actual invoice records and time entries. It keeps currencies separate and labels recorded hourly rates as cost proxies; it excludes overhead, tax, payment fees and unrecorded work.
- Client activity includes contract and communication entries as well as existing linked project/email/invoice/scope-change activity.

## Deploy
1. Back up production PostgreSQL using the existing backup procedure.
2. Extract the v4.9.0 source into the existing repository. Preserve `.git`, `.env`, and deployment settings.
3. Run CI and review the release verification report.
4. Run `alembic upgrade head` once.
5. Deploy API and frontend from the same commit.
6. Open `/clients`; create a test client, SOW draft and manual communication note. Verify contract decision requires sent status and evidence for acceptance. Verify profitability only reflects linked invoice/time-entry records.

## Safety and limitations
- No external marketplace, email, signature or payment processor integration is added by this release.
- No automatic sending, client signing, invoicing or money movement occurs.
- Do not treat `accepted` as legally verified signature evidence; retain the original signed document or client email separately.
- Client records remain account-owned; all new API queries filter by authenticated `user_id`.
