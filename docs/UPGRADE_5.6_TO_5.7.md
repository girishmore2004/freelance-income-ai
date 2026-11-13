# Upgrade Freelance Income AI 5.6.0 → 5.7.0

## Summary

v5.7.0 adds an account-scoped, read-only Upwork GraphQL opportunity search using the documented `marketplaceJobPostingsSearch` query. Results are normalized into the existing opportunity model, scored against the user's current profile, and deduplicated through the existing source fingerprint mechanism. The UI adds search, import, and cursor-based next-page controls.

The release reuses the existing OAuth state, marketplace credential, marketplace connection, audit, and opportunity tables. **No database migration is required.** Proposal submission remains disabled.

Upwork's API documentation states that API response caching must not exceed 24 hours. This release therefore redacts Upwork-sourced listing content after 22 hours, leaving a safety margin. The search endpoint fails closed until you configure an hourly retention task and explicitly enable it.

## Provider requirements

Before enabling the feature for a real account:

1. Apply for an Upwork API key and receive approval. Approval is controlled by Upwork and is not guaranteed.
2. Request the `Read marketplace Job Postings` permission/scope and any other scope required by your approved key. The common-entities read-only permission may also be required by Upwork for some queries.
3. Configure the exact OAuth callback URL: `https://YOUR_API_HOST/api/v1/marketplaces/upwork/oauth/callback`.
4. Use the registered client ID and secret and the same `OAUTH_ENCRYPTION_KEY` already used by stored credentials.
5. The app omits the optional organization-context header and lets Upwork use the authenticated user's default organization. This avoids a global tenant ID being reused across different user accounts; user-specific organization selection is future work.
6. Keep API key scopes least-privileged. Do not request or enable proposal-write scopes for this read-only feature.

Official references:

- Upwork GraphQL API: https://www.upwork.com/developer/documentation/graphql/api/docs/index.html
- Upwork Developer Space and API key application: https://www.upwork.com/developer

Upwork's public docs describe the GraphQL endpoint as `https://api.upwork.com/graphql`, the `marketplaceJobPostingsSearch` operation, the `Read marketplace Job Postings` permission, OAuth 2.0, and the optional `X-Upwork-API-TenantId` organization-context header. Check the current provider documentation and your approved key configuration before deployment; API schemas and scope grants are provider-controlled.

## Environment variables

Existing variables remain required:

- `UPWORK_CLIENT_ID`
- `UPWORK_CLIENT_SECRET`
- `UPWORK_REDIRECT_URI`
- `UPWORK_SCOPES` — only scopes actually approved for your API key
- `OAUTH_ENCRYPTION_KEY` — preserve the existing key

New variables:

- `UPWORK_CACHE_RETENTION_ENABLED=true` — set only after the hourly cleanup task is running. Default is `false`; while false, Upwork discovery returns HTTP 503 rather than storing provider listing content without a retention mechanism.

Never put these values in frontend variables or commit them to Git.

## Upgrade

1. Back up PostgreSQL and retain a copy of v5.6.0.
2. Extract v5.7.0 over the existing tracked source tree. Preserve `.git`, `.env`, uploads and deployment settings.
3. Run CI and the focused tests.
4. Push a release branch:

```bash
git checkout -b upgrade/v5.7.0
git add .
git commit -m "Upgrade Freelance Income AI to v5.7.0"
git push -u origin upgrade/v5.7.0
```

5. Deploy to staging before production. No Alembic command is required for this release.
6. Configure the included `.github/workflows/upwork-cache-retention.yml` with repository secret `PRODUCTION_DATABASE_URL`, or create an hourly Render Cron Job that runs `cd backend && python -m app.retention_cleanup` using the same database. The GitHub Actions option requires an externally reachable SQLAlchemy database URL using the `postgresql+psycopg://` driver; use a Render Cron Job when the database is only reachable inside Render's private network.
7. Confirm the schedule has run successfully. Only then set `UPWORK_CACHE_RETENTION_ENABLED=true` on the API service and redeploy.

## Test the live read-only flow

1. Sign in and open Marketplace Integrations.
2. Connect Upwork using the OAuth flow.
3. Confirm the credential status is `stored_unverified` after consent. This means tokens were stored; it does not yet prove GraphQL access.
4. Search a short keyword phrase in **Upwork read-only opportunity discovery**.
5. On successful GraphQL response, the connection becomes `api_verified`; imported opportunities are scored and deduplicated.
6. If the request returns HTTP 409, check API approval and the read-only marketplace scope. HTTP 429 means wait before searching again.
7. Confirm imported listings appear in Opportunity Intelligence and inspect their source, budget, skills and match explanation.
8. Confirm no proposal/application was submitted. Submission is intentionally disabled.

The search currently imports one page per request (up to 50 records); use **Load next page** to continue. API search responses do not supply a verified browser URL in the selected fields, so the app does not fabricate one. Payment verification is left unknown unless the provider supplies that field in a future approved query. Listing content is redacted after 22 hours; a new search can refresh an expired record. User-authored proposal/review records and stable local record IDs are retained.

## Rollback

Re-deploy v5.6.0 source. No schema rollback is needed. The v5.7.0 release creates no new tables or migrations. Preserve the OAuth encryption key so stored credentials remain decryptable.
