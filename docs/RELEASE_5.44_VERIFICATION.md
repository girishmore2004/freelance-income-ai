# Release 5.44.0 verification

## Implemented
- RFC 6238 TOTP generator/verifier with ±1-step clock tolerance.
- Strict six-digit TOTP input and accepted-step replay protection.
- Fernet encryption of TOTP secrets using a purpose-derived key from `SECRET_KEY`.
- Ten random recovery codes, stored only as SHA-256 hashes, one-time use and rotation.
- Single-use, expiring, database-backed MFA challenges with attempt limit.
- Login lockout after repeated password or MFA failures.
- Session revocation when enabling/disabling MFA.
- Frontend login MFA challenge and `/security` setup, disable and recovery rotation controls.
- Migration `0045_mfa_and_login_lockout`, down-revision `0044_account_security`.

## Checks run in this environment
- Focused regression suite: **93 passed**.
- Python compileall: **passed**.
- Release packaging tests: **2 passed**.
- Static Alembic chain validation: **45 revisions, one head (`0045_mfa_and_login_lockout`)**.

## Not completed
- Full backend suite attempted: collection stopped with **16 errors** because the build environment lacks `langgraph`, `redis` and `jose` packages. Alembic runtime `heads` was blocked by missing `pgvector`.
- Alembic migration was not applied to a live PostgreSQL database.
- Frontend build and browser end-to-end tests were not run because `node_modules` is absent. A global `tsc --noEmit` attempt produced dependency/type-environment errors (`react` and Node types missing); no TS syntax diagnostic was observed in the changed pages.
- No live authenticator app, SMTP provider, Redis or production database was available for integration verification.
- No independent penetration test or external security review was performed.

## Production gate
Do not describe the release as fully production-certified until full CI, migration upgrade/downgrade tests, concurrent challenge/recovery-code tests, frontend E2E and a staging security review pass.
