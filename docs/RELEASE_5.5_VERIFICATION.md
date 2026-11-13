# Release 5.5.0 verification record

## Implemented
- Added encrypted per-user marketplace token storage using the existing Fernet dependency and `OAUTH_ENCRYPTION_KEY`.
- Added provider allowlisting and fail-closed behavior for missing, malformed or incorrect encryption keys.
- Added metadata-only credential status and authenticated owner-initiated local credential deletion endpoints. Token values are never returned by these endpoints.
- Added audit events for credential material storage and local deletion. Audit details contain no token values.
- Stored token material is marked `stored_unverified`; it is not treated as proof of provider identity, OAuth completion or live API access.
- Added Alembic revision `0028_marketplace_credential_vault`, parent `0027_opportunity_reviews`.
- No public raw-token endpoint, OAuth start/callback, provider API request, refresh, remote revocation or marketplace submission is implemented.

## Checks run
- Focused backend tests: **41 passed** across credential vault, marketplace adapter/service, opportunity intelligence, client business intelligence, payment reconciliation and contract policy/revision suites.
- Test environment did not have `pgvector` installed. The focused tests were run with a temporary import-only `pgvector.sqlalchemy.Vector` stub; this does not validate PostgreSQL/pgvector behavior.
- Python compilation: run during packaging; see package verification output.
- Alembic migration graph: static revision-chain check only; migration not executed against PostgreSQL.
- ZIP CRC and per-file SHA-256 manifest: verified by the release packager.

## Not verified / release limitations
- PostgreSQL migration execution and rollback.
- Full backend suite against PostgreSQL/pgvector and Redis/RQ.
- Frontend TypeScript typecheck, production build and browser E2E.
- Real provider OAuth, scopes, token refresh, API calls, provider-side revoke or live discovery.
- Cloud staging, load tests, backup/restore drill and production smoke tests.

This is a packaged development release, not production-certified. Do not enable a provider OAuth callback or expose token ingestion until provider-specific OAuth state/PKCE validation, redirect allowlisting, official token exchange and security tests are implemented.
