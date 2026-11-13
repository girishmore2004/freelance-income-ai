# Release 1.6 — Marketplace integration foundation

## Scope
v1.6 adds provider capability visibility, per-user marketplace readiness settings, an application pipeline, hash-bound approval of a specific proposal version, manual submission recording, outcome tracking and audit history.

## Provider status and honest limitations
- **Upwork:** official GraphQL API documentation exists. API key access is subject to Upwork eligibility/review. No live API client or proposal submission is enabled.
- **Freelancer.com:** official developer API exists. Provider credentials and endpoint-specific implementation are still required. No live client or proposal submission is enabled.
- **Fiverr:** manual tracking and permitted feeds only in this release.
- **LinkedIn:** job-related API access is restricted to approved partner programs; no job-search API is enabled.
- Existing RSS/Atom and public JSON discovery continues to work.

No marketplace scraping, browser automation, CAPTCHA bypass, credential collection or auto-apply is included. `record-submission` records a submission the user made outside the app; it does not submit anything.

## New APIs
- `GET /api/v1/marketplaces`
- `PUT /api/v1/marketplaces/{provider}/settings`
- `POST /api/v1/marketplace-applications`
- `GET /api/v1/marketplace-applications`
- `POST /api/v1/marketplace-applications/{id}/approve`
- `POST /api/v1/marketplace-applications/{id}/record-submission`
- `PATCH /api/v1/marketplace-applications/{id}/status`
- `GET /api/v1/marketplace-applications/{id}/audit`

Approval requires a proposal ID and the current SHA-256 hash of its exact content. Editing a proposal changes the hash, so stale approval is rejected. No provider submit operation exists in v1.6.

## Migration
Alembic revision `0014_marketplace_foundation` follows `0013_communication_intelligence`.
Run `alembic upgrade head` from `backend/` or restart the Docker API service if its entrypoint performs migrations.

## UI
Open `/marketplaces` after signing in to view provider readiness, select an access mode and track applications.

## Security
Marketplace settings accept only non-secret metadata. API secrets and access tokens must never be pasted into the settings endpoint. Provider credentials require a future dedicated encrypted-secret/OAuth implementation, least-privilege scopes, state/PKCE validation, tenant isolation and a provider-specific security review.

## Official access references checked for this release
- Upwork API documentation: https://www.upwork.com/developer/documentation/graphql/api/docs/index.html
- Upwork API-key eligibility: https://support.upwork.com/hc/en-us/articles/115015857647-How-to-request-an-API-key-from-Upwork
- Freelancer developer portal: https://developer.freelancer.com/
- LinkedIn API access model: https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access

Upwork's current API-key requirements include identity/profile/payment verification and a stated lifetime earnings/spend threshold; access is reviewed and is for personal/internal use. LinkedIn's open consumer permissions do not include general job-search access; most other API products require approval. Verify current provider rules before enabling a connector.
