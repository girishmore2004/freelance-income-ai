# Upgrade Freelance Income AI 5.5.0 → 5.6.0

## Summary

This release adds an Upwork OAuth 2.0 authorization-code flow with PKCE, one-time state validation, encrypted token storage, manual token refresh, and metadata-only status. It reuses the existing `email_oauth_states` and `marketplace_credentials` tables; **no database migration is required**.

## Before deployment

1. Back up PostgreSQL and retain a copy of v5.5.0.
2. Confirm you have Upwork API approval and the exact approved scopes. Upwork's current public documentation lists eligibility requirements; API approval is not guaranteed.
3. Register the exact callback URL: `https://YOUR_API_HOST/api/v1/marketplaces/upwork/oauth/callback`.
4. Configure these backend environment variables:
   - `UPWORK_CLIENT_ID`
   - `UPWORK_CLIENT_SECRET`
   - `UPWORK_REDIRECT_URI` (must exactly match the registered callback; HTTPS in production)
   - `UPWORK_SCOPES` (space-separated scopes explicitly granted to your key; no guessed default)
   - `OAUTH_ENCRYPTION_KEY` (preserve the existing key if it encrypts other provider tokens)
5. Never commit secrets or share them in chat.

## Upgrade

Extract this release over the existing tracked source tree. Preserve `.git`, `.env`, uploads, database and deployment settings.

```bash
git checkout -b upgrade/v5.6.0
git add .
git commit -m "Upgrade Freelance Income AI to v5.6.0"
git push -u origin upgrade/v5.6.0
```

Run CI and staging checks before merging and deploying. No Alembic command is required for this release.

## OAuth test

1. Sign in to the application and open Marketplace Integrations.
2. Choose **Connect Upwork account**.
3. Review the requested provider permissions and approve only if expected.
4. After callback, check `GET /api/v1/marketplaces/upwork/credential-status`.
5. Expected state after successful token exchange: `stored_unverified`, `live_api_verified: false`.
6. Do not interpret this as successful GraphQL API access. This release does not yet query the Upwork API.
7. To disconnect locally, use the credential delete endpoint and separately revoke the app at Upwork.

## Deployment

- Render: configure environment variables on the API service. Do not expose `UPWORK_CLIENT_SECRET` or `OAUTH_ENCRYPTION_KEY` to the frontend.
- Vercel: no Upwork secrets are needed in frontend environment variables.
- Verify callback reachability, HTTPS, CORS, and logs. OAuth callback errors are intentionally generic and do not include token data.

## Rollback

Re-deploy v5.5.0 source. No schema rollback is needed. If tokens were created, delete them through the account credential endpoint and revoke the app authorization in Upwork as appropriate. Preserve the encryption key until all other encrypted provider tokens have been migrated or revoked.
