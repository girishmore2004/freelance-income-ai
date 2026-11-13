# Release 1.4 — Email Provider Integration

## Delivered
- Google and Microsoft OAuth authorization-code flow with state, 10-minute expiry and PKCE S256.
- PKCE verifier and provider access/refresh tokens encrypted using Fernet.
- Tenant-scoped provider accounts and OAuth states.
- Access-token refresh and reauthorization-required state on refresh failure.
- Gmail and Outlook recent-message sync with provider message ID deduplication.
- Gmail thread-aware send and Outlook reply-draft creation/update/send.
- Exact approval binding to subject, body, original recipient and provider.
- Explicit send endpoint and one-way `sending` state to avoid duplicate retry sends.
- Disconnect endpoint; Google token revocation attempted, Microsoft consent removal remains user action.
- Inbox UI for connect, sync, disconnect and explicit send.

## Required external configuration
Live provider access is not preconfigured. The operator must create Google Cloud / Microsoft Entra OAuth apps, configure consent and exact callback URLs, and set the provider credentials plus `OAUTH_ENCRYPTION_KEY` in the deployment environment. No secrets are included in this release archive.

## Sync boundaries
- Gmail: at most 50 messages matching `in:inbox newer_than:30d` per manual sync.
- Outlook: at most 50 recent messages from the Inbox folder per manual sync.
- Imports are idempotent by a user/provider/message fingerprint protected by a unique database index.
- Provider push notifications, automatic background sync and durable incremental cursors are future work.

## Safety boundaries
- Approval does not send.
- The explicit send endpoint rechecks the digest including subject, body, original recipient and provider.
- Recipient is always the original sender address stored on the inbound email; the API does not accept an arbitrary send-to address.
- Only provider-synchronized messages (`provider_verified=true`) can be sent. Manual intake remains draft-only.
- A send exception is recorded as `send_unknown`, not automatically retried. Check Sent mail before manually taking action.
- Outlook uses Graph `createReply` -> update reply draft -> send. Gmail uses the original Gmail thread ID and RFC message ID where available.
- Google token revocation is attempted on disconnect. Microsoft credentials are deleted locally; remove the app's consent from Microsoft account settings too.
- Marketplace submissions remain disabled.

## Migration
- `0012_email_provider_oauth.py` follows `0011_email_intake.py`.
- Adds provider account and OAuth state tables, RFC message ID, approval recipient/provider and sent metadata.
- Existing manual email records remain intact.

## Verification
- 52 focused backend/unit tests passed, including 7 email-provider tests.
- Python AST and compile checks passed across backend files.
- Frontend TSX syntax diagnostics: zero.
- JSON and Docker Compose YAML validation passed.
- Alembic migration 0012 upgrade/downgrade smoke test passed on SQLite.
- SQLite ORM metadata creation smoke test passed.
- The focused test run used a minimal pgvector SQLAlchemy type stub only to permit ORM imports in this packaging environment. It did not test PostgreSQL vector operations.
- The complete suite could not be collected because this environment lacks `python-jose`, `passlib`, `redis`, `langgraph` and `pgvector`. These are declared in `backend/requirements.txt`; Docker installs the requirements.
- Live Google/Microsoft OAuth, provider sync/send, PostgreSQL migration execution and frontend production build require provider credentials and deployment services and were not run here.
