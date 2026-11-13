# Release 5.7.0 verification record

## Scope

- Official Upwork GraphQL read-only job search through `marketplaceJobPostingsSearch`.
- Account-scoped use of encrypted OAuth access tokens.
- Expired access token refresh through the existing OAuth service.
- Uses the authenticated user's default Upwork organization context; no global tenant ID is shared across accounts.
- Bounded retry for HTTP 429 and safe provider/network error handling.
- Normalization into the existing opportunity ingestion and deduplication path.
- Cursor-based page continuation and explicit read-only UI.
- Connection status is marked `api_verified` only after a successful GraphQL search.
- Upwork listing content is redacted after a 22-hour cache window; hourly GitHub Actions or Render Cron cleanup is included. Discovery fails closed unless retention is explicitly enabled.
- Marketplace proposal submission remains disabled.

## Checks executed

- Focused marketplace/OAuth/opportunity/finance/contract regression selection: **75 passed**.
- Python compilation (`compileall`): passed.
- TypeScript TSX syntax transpilation for the Marketplace page: passed.
- Static migration review: no new migration; existing schema reused.
- ZIP CRC, SHA-256 manifest, forbidden-file and secret/cache checks: performed during packaging.

The test run used a temporary import-only `pgvector` SQLAlchemy type stub because `pgvector` is not installed in the packaging environment. The stub is outside the delivered project and is not a runtime substitute.

## Not verified in this environment

- Full FastAPI app import/route registration: blocked because the packaging environment lacks `python-jose`, although it is declared in `backend/requirements.txt`.
- Full backend test suite with the pinned production dependencies.
- PostgreSQL/pgvector integration and live Alembic execution.
- Actual execution/monitoring of the hourly retention workflow against the user's production database.
- Frontend dependency installation, `tsc --noEmit`, Next.js production build, and Playwright browser tests.
- Actual Upwork developer approval, user consent, live token exchange, GraphQL query execution, account-specific scopes, and tenant organization context.
- Render/Vercel staging or production smoke tests.

The GraphQL request and result mapping are covered with mocked provider responses. This is a code-and-focused-test release, not a production certification. A live `api_verified` state can only be earned by a successful authenticated GraphQL request in the user's deployment.
