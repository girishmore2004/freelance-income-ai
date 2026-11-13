# Release 5.43.0 verification

## Implemented in source
- Email verification and resend with single-use 24-hour tokens.
- Password reset with enumeration-safe response, single-use 30-minute token and session revocation.
- Password change with current-password check and new session issuance.
- Database-backed JWT sessions, single-session revoke, logout and logout-all.
- Token digests stored with SHA-256; password hashes use bcrypt_sha256 with legacy bcrypt verification.
- SMTP STARTTLS/implicit TLS sender.
- Frontend verification/reset handling uses URL fragments (not query strings) to reduce token exposure in HTTP access logs; session management is at `/security`.
- Migration `0044_account_security`; existing accounts migrated as verified.

## Focused verification
- New account security and production config tests.
- Python compilation and static Alembic revision chain checks.
- Release packaging integrity.

## Not completed in this build environment
- Full backend test collection: missing `pgvector` and `langgraph` packages.
- Frontend `npm ci`, production build, typecheck and browser E2E: dependencies not installed.
- Runtime Alembic migration against PostgreSQL.
- Live SMTP delivery and real-world token replay/concurrency tests.
- External security audit, MFA, passwordless login, CAPTCHA/bot defense, email deliverability validation and backup/restore drill.

## Security caveats
- Email verification proves control of the mailbox at verification time; it does not establish legal identity.
- Password reset relies on secure email account access; MFA is not included in this release.
- Session records currently do not capture IP address or device fingerprint, by design; session list shows creation/expiry and revocation only.
- SMTP delivery must be configured and verified by the deployer.

## Build-environment results (2026-11-13)
- Focused regression suite: **110 passed**.
- Python `compileall`: **passed**.
- Release packager tests: **2 passed**.
- Static Alembic chain: **44 revisions, no missing parents, one head (`0044_account_security`)**.
- Environment inventory: all settings declared in `backend/app/core.py` are represented in `.env.example`.
- Full backend suite attempted: collection blocked with 16 errors because this build environment lacks runtime packages including `python-jose`, `passlib`, `redis` and `langgraph` (and `pgvector` is not installed).
- Frontend production build attempted: blocked because `frontend/node_modules` is absent (`next: not found`).
- No live PostgreSQL migration or SMTP delivery was run.
