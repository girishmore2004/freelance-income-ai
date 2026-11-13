# Upgrade v5.43.0 to v5.44.0

## What changes
- TOTP authenticator MFA with QR-compatible `otpauth://` URI (manual secret entry is supported).
- Encrypted TOTP secrets, ten one-time recovery codes, recovery-code rotation.
- Single-use, database-backed login challenge with a 5-minute default lifetime and five-attempt cap.
- TOTP time-step replay prevention.
- Failed password and second-factor lockout, default 8 failures / 15 minutes.
- Enabling or disabling MFA revokes all active sessions.
- Migration `0045_mfa_and_login_lockout`.

## Pre-upgrade
1. Back up PostgreSQL and confirm a restore point.
2. Preserve the exact production `SECRET_KEY`; do not rotate it.
3. Deploy backend and worker source from the same commit.
4. Verify Redis is available because authentication rate limiting is Redis-backed in production.

## Database
Run once after backup:

```bash
cd backend
alembic upgrade head
```

Expected head: `0045_mfa_and_login_lockout`. This adds four user fields and two MFA tables. Existing user MFA defaults to disabled.

## Frontend
Deploy the updated Next.js frontend. Existing v5.43 sessions remain valid until revoked by account action.

## Validation
- Sign in with a non-MFA account.
- Set up MFA at `/security`; verify current password is required.
- Confirm a TOTP code and verify all existing sessions are revoked.
- Sign in again; verify password login returns an MFA challenge rather than an access token.
- Complete login with TOTP; try the same challenge again (must fail).
- Use one recovery code; verify it cannot be reused.
- Rotate recovery codes; verify old codes fail and new codes work.
- Disable MFA with password plus TOTP/recovery code; verify sessions are revoked.
- Enter eight invalid passwords and confirm lockout; verify correct password is still blocked until lockout expires.
- Test MFA challenge expiry and five-attempt cap.

## Security notes
TOTP secrets are encrypted using a purpose-derived Fernet key from `SECRET_KEY`. Changing `SECRET_KEY` makes stored TOTP secrets unreadable and invalidates sessions. Recovery codes are random and stored only as SHA-256 hashes. Never log or commit the one-time secret or recovery codes.
