# Release 4.0.0 verification report

## Package checks
- Source base: v3.9.0 ZIP.
- No database migration added.
- No new environment variables added.
- No credentials or `.env` files are included.
- Focused tests run in the build environment: `tests/test_oauth_lifecycle_v40.py`, `tests/test_email_providers.py`, `tests/test_marketplace_service.py`.
- Result: **13 passed**.
- Python compile check: recorded separately in the release build process.
- ZIP CRC and SHA-256 manifest checks: recorded in final package manifest.

## Focused test coverage
- OAuth state expires and is rejected before network access.
- A token-exchange transport failure still consumes the state; callback replay is rejected.
- A successful callback stores the provider account against the user bound to the state, not another account.
- Access and refresh tokens are encrypted at rest.
- Provider identity lookup transport failures return HTTP 502 and do not create an account.
- Existing provider configuration, token encryption, message parsing and fail-closed marketplace catalog tests remain passing.

## Not verified in this build environment
- Full API test collection and PostgreSQL/pgvector integration.
- Live Redis outage/recovery and multi-worker behavior.
- Frontend install, typecheck, production build and Playwright browser tests.
- Dependency vulnerability audit.
- k6 staging baseline, backup/restore drill and production deployment.
- Human-reviewed RAG quality benchmark on a real authorized dataset.

The local Python environment does not have `python-jose` or `pgvector` installed. A test-only pgvector SQLAlchemy shim was available for focused SQLite tests; it is not part of the release. Do not interpret the focused pass count as full-suite or production certification. The existing GitHub Actions full-CI workflow provisions PostgreSQL with pgvector and Redis and installs the declared backend dependencies; use its result as the full integration gate.
