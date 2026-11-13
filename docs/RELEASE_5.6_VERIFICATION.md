# Release 5.6.0 verification record

## Scope

Upwork OAuth authorization-code + PKCE foundation, server-side one-time state, encrypted token persistence, manual refresh, production configuration validation, and frontend connection entry point.

## Deliberate limitations

- No Upwork identity/profile endpoint is called after token exchange.
- No Upwork GraphQL discovery/query implementation is enabled.
- No Freelancer OAuth implementation is included; the public developer portal does not sufficiently establish this application's authorized auth contract.
- No marketplace proposal submission is enabled.
- Successful token exchange is `stored_unverified`; `live_api_verified` remains false.
- Refresh is an explicit authenticated endpoint, not an automatic scheduler.

## Verification status

Run the included focused OAuth tests, prior credential-vault and marketplace tests, Python compile, frontend TSX syntax checks, Alembic static graph check, and ZIP/manifest integrity checks before release. PostgreSQL integration, actual provider credentials/consent, live token exchange, full frontend production build, and cloud staging require deployment credentials and were not simulated.

## Checks executed in this packaging environment

- Focused test selection: **26 passed**. The runtime did not have `pgvector` installed, so the test invocation supplied a temporary SQLAlchemy type stub for model import; this is not a substitute for running against the pinned production dependency set.
- Python source compilation and AST parsing: passed.
- Marketplace page TSX syntax transpilation using the installed TypeScript compiler: passed.
- Full FastAPI app import/route registration: not completed because this packaging environment also lacks `python-jose`; the dependency is declared in `backend/requirements.txt` and must be installed in CI.
- Frontend dependency install, full `tsc --noEmit`, Next.js production build, PostgreSQL integration, actual Upwork consent/token exchange, and cloud staging: not run.

This is a code-and-focused-test release, not a production certification.
