# Upgrade Freelance Income AI 5.3.0 → 5.4.0

## Summary

This is a backward-compatible marketplace integration hardening release. It does not add a database migration or new runtime dependency.

- Adds a fail-closed adapter contract for Upwork and Freelancer.com.
- Adds `GET /api/v1/marketplaces/{provider}/readiness` for account-scoped readiness reporting.
- Prevents settings from marking an official marketplace API as configured without a real, verified provider connection.
- Maps legacy `configured` metadata to `not_verified` in API responses. Existing records are retained; no database rewrite is needed.
- Keeps discovery limited to the existing RSS/Atom, public JSON and manual import mechanisms.
- Keeps proposal submission disabled. No scraping, browser automation, OAuth credential storage or marketplace API calls are implemented in this release.

## Upgrade

1. Back up PostgreSQL and verify the backup.
2. Extract this release over the existing repository, preserving `.git`, `.env`, deployment settings and user uploads.
3. Install backend dependencies from `backend/requirements.txt` (no new runtime packages are required).
4. No Alembic migration is required. Confirm the migration head remains `0027_opportunity_reviews`.
5. Run backend tests and frontend checks in CI before deploying.
6. Deploy the API and frontend through the existing Render and Vercel services.

## Marketplace behavior change

The settings API now rejects `official_api_configured` with HTTP 409. The UI only allows `manual`, `permitted_feed`, and `official_api_pending`. A legacy record previously marked `configured` is returned as `not_verified`; it is not deleted.

## Provider access facts checked for this release

- Upwork documents a GraphQL API, OAuth 2.0 and API key application. Its current API key requirements include account verification and a minimum combined lifetime earnings/spend threshold of USD 25,000, plus other eligibility requirements. Upwork states that API access for personal/internal use is available to qualifying users; commercial use requires separate permission. Check the live official requirements before applying.
- Freelancer.com maintains an official developer portal and advertises API documentation and a sandbox. The project does not yet have user credentials, confirmed scopes, or a tested endpoint integration, so it does not claim a live connector.

Official references:
- https://www.upwork.com/developer/documentation/graphql/api/docs/index.html
- https://support.upwork.com/hc/en-us/articles/115015857647-How-to-request-an-API-key-from-Upwork
- https://support.upwork.com/hc/en-us/articles/115015933448-API-authentication-and-security
- https://developer.freelancer.com/

## Rollback

Revert the application code to v5.3.0. No schema downgrade is necessary. The API will continue to read the existing `marketplace_connections` rows.
