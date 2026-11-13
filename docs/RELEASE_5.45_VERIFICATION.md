# Release 5.45.0 verification record

## Source changes
- Sensitive MFA setup, enable, disable and recovery-code rotation now re-fetch and lock the account row using SQLAlchemy `SELECT ... FOR UPDATE` before state validation and mutation.
- The existing MFA login challenge path already locks the account and challenge rows.
- Added static regression coverage for mutation locking, cross-account isolation test inventory, backup/restore safety guards, full CI gates and release version consistency.
- Added an operator-led backup/restore rehearsal runbook and upgrade/deployment instructions.
- No schema migration or new runtime dependency.

## Validation performed

- `python -m compileall -q backend/app backend/tests`: **PASS**.
- Focused pytest suite (`test_security_readiness_v545.py`, `test_mfa_v544.py`, `test_system_diagnostics_v542.py`, `test_production_config_v542.py`, `test_delivery_health_v536.py`): **30 passed**.
- `python -m unittest discover -s ops/tests -v`: **2 passed**.
- Static Alembic chain inspection: **45 revisions, one head `0045_mfa_and_login_lockout`, no missing parents**.
- Full tenant integration test collection attempted but blocked because `pgvector` is not installed in this local runtime.
- Frontend typecheck/build not run because `frontend/node_modules` is absent.
- Live PostgreSQL locking, SMTP, Redis, external dependency audit and restore rehearsal were not run.

## Required external/staging gates
- Run complete backend tests with PostgreSQL + pgvector + Redis and all declared Python dependencies.
- Run frontend typecheck, production build and browser E2E in GitHub Actions.
- Verify simultaneous MFA setup/enable/disable/recovery-code requests against PostgreSQL; SQLite does not implement row-level `FOR UPDATE` locking.
- Complete an encrypted off-host backup and disposable PostgreSQL restore rehearsal.
- Review `pip-audit` and `npm audit` findings.
- Obtain independent security review/penetration test before claiming certification.

This release is security hardening, not a penetration-test report, compliance certification, or production recovery SLA.
