# Upgrade Freelance Income AI 5.4.0 → 5.5.0

## What's new
- Adds an encrypted per-user marketplace OAuth credential vault for Upwork and Freelancer.com.
- Uses the existing `OAUTH_ENCRYPTION_KEY` Fernet key; token material is encrypted before persistence.
- Adds non-secret credential status and owner-initiated local credential deletion endpoints.
- Adds strict provider allowlisting and fail-closed encryption/decryption behavior.
- No public endpoint accepts raw marketplace tokens. A future provider OAuth callback must validate state/PKCE and official token exchange before calling the internal `save_tokens` service.
- This is not a live marketplace connector: OAuth start/callback, provider API requests, token refresh and remote revocation are not implemented. `live_api_verified` and proposal submission remain false.

## Upgrade
1. Back up PostgreSQL and verify the backup.
2. Extract over the existing repository; preserve `.git`, `.env`, uploads and deployment configuration.
3. Preserve the existing `OAUTH_ENCRYPTION_KEY` if Gmail or Microsoft OAuth is already in use: changing it makes previously encrypted email tokens unreadable. If no key exists, set a valid Fernet key before any future marketplace OAuth connection is enabled. Generate one with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and store it only in the hosting secret manager. Back it up securely and do not rotate it without a planned re-encryption migration.
4. Run `cd backend && alembic upgrade head` exactly once after backup.
5. Run backend tests and frontend production build in CI/staging.
6. Deploy API and frontend after staging verification.

## New endpoints
- `GET /api/v1/marketplaces/{provider}/credential-status` — metadata only; never returns tokens.
- `DELETE /api/v1/marketplaces/{provider}/credentials` — deletes local encrypted token material. It does not revoke provider-side authorization; users must separately revoke access in their provider account.

## Migration
- Revision: `0028_marketplace_credential_vault`
- Parent: `0027_opportunity_reviews`

## Rollback
Revert application code and run `alembic downgrade 0027_opportunity_reviews` only if the v5.5 vault data can be discarded and the backup is verified. Downgrade deletes the credential table and its encrypted token material.
