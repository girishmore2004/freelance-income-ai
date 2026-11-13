# Upgrade v5.42.0 to v5.43.0

1. Back up PostgreSQL.
2. Deploy source v5.43.0.
3. Configure SMTP, `REQUIRE_EMAIL_VERIFICATION=true` and HTTPS `PUBLIC_APP_URL` before opening registration.
4. Run `alembic upgrade head` once; expected head `0044_account_security`.
5. Deploy frontend and worker from the same commit.
6. Re-authenticate users; v5.42 tokens do not carry the new session identifier.
7. Test verification, password reset, single-session revoke and logout-all in staging.
8. Disable public registration after first account setup.

Existing users are migrated with `email_verified=true`. New users are unverified when production verification is enabled. Downgrade drops the new session/token tables and email_verified column; only use it with a planned rollback and a DB backup. A downgrade does not restore v5.42 tokens as valid in the v5.43 application.
