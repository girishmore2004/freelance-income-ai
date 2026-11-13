# Freelance Income AI v5.45.0 — deployment guide

## 1. Release contents
- MFA mutation serialization using PostgreSQL account-row locks.
- Security regression checks and backup/restore rehearsal runbook.
- No new database migration; existing Alembic head remains `0045_mfa_and_login_lockout`.
- Email verification and resend.
- Enumeration-safe password reset.
- Password change and revocable database-backed sessions.
- Account security page at `/security`.
- TOTP authenticator MFA, recovery codes and login lockout.
- Migration `0045_mfa_and_login_lockout`.

## 2. Before deployment
1. Download and extract the v5.45.0 ZIP.
2. Back up the production PostgreSQL database and retain a tested restore point.
3. Confirm Render API, Render worker and Vercel frontend are connected to the same release commit.
4. Configure all backend secrets in Render only. Do not commit `.env`.

## 2A. Push this release to GitHub
Extract the ZIP, open a terminal in the extracted project root (the folder containing `VERSION`), and verify the version:

```bash
cat VERSION
```

It must show `5.45.0`. Then push to your existing repository:

```bash
git status
git add .
git commit -m "Release Freelance Income AI v5.45.0 - MFA and login protection"
git push origin main
```

For a new GitHub repository, create an empty repository first, then:

```bash
git init
git add .
git commit -m "Initial Freelance Income AI v5.45.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/freelance-income-ai.git
git push -u origin main
```

Do not commit `.env`, SMTP passwords, `SECRET_KEY`, database URLs, Redis URLs or API keys. Check `git status` and `.gitignore` before pushing.

## 3. SMTP setup (production required)
Set these Render backend environment variables:

```env
ENVIRONMENT=production
REQUIRE_EMAIL_VERIFICATION=true
PUBLIC_APP_URL=https://YOUR-VERCEL-DOMAIN
SMTP_HOST=YOUR_PROVIDER_SMTP_HOST
SMTP_PORT=587
SMTP_USERNAME=YOUR_PROVIDER_SMTP_USERNAME
SMTP_PASSWORD=YOUR_PROVIDER_SMTP_PASSWORD
SMTP_FROM_EMAIL=YOUR_VERIFIED_SENDER
SMTP_FROM_NAME=Freelance Income AI
SMTP_USE_SSL=false
PUBLIC_REGISTRATION=true
```

Use provider-issued SMTP credentials. Brevo SMTP, Resend SMTP or Gmail SMTP with an App Password are possible providers to evaluate. Availability and free-tier limits change; check the provider's current terms and sender verification requirements. For Gmail, enable 2-Step Verification and create an App Password; do not use your normal account password. For custom domains, configure SPF, DKIM and DMARC.

Port 587 uses STARTTLS (`SMTP_USE_SSL=false`). Port 465 uses implicit TLS (`SMTP_USE_SSL=true`). Do not expose these settings to the browser.

## 4. Deploy backend and worker
- Render API root: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Render worker start: `python worker.py`
- API and worker share `DATABASE_URL`, `REDIS_URL` and required app secrets.

Run the migration once from the backend release environment, after backup:

```bash
cd backend
alembic upgrade head
```

Expected Alembic head: `0045_mfa_and_login_lockout`.

For Render Free, run the one-time migration from a trusted local machine with the exact production `DATABASE_URL` configured in Render, after installing `backend/requirements.txt`. Verify the database name/host before executing. Never run migrations concurrently from multiple API replicas.

## 5. Deploy frontend
- Vercel root: `frontend`
- Build: `npm run build`
- Environment: `NEXT_PUBLIC_API_URL=https://YOUR-RENDER-API.onrender.com`

The frontend reads verification and password-reset tokens from the URL fragment on the login page; fragments are not sent in normal HTTP requests. Ensure `PUBLIC_APP_URL` exactly matches the Vercel frontend origin.

## 6. First account onboarding
1. Keep `REQUIRE_EMAIL_VERIFICATION=true`.
2. Temporarily set `PUBLIC_REGISTRATION=true` in Render.
3. Deploy API and frontend.
4. Create your account from the login screen.
5. Open the verification email and follow the link.
6. Sign in and check `/security`.
7. Set `PUBLIC_REGISTRATION=false` in Render and redeploy the API.

If the SMTP provider blocks or delays delivery, check provider logs, sender verification, SPF/DKIM and spam folder. Do not disable verification in production as a workaround; repair SMTP instead.

## 7. Validate the release
- `/health` reports version `5.45.0`.
- `/ready` returns ready after migration and service checks.
- Register a test account; verify the email.
- Try login before verification (must be rejected) and after verification (must succeed).
- Request password reset for a known and an unknown email; response text/status should be the same.
- Reset password; old password must fail and prior sessions must be revoked.
- Sign in from two browsers; revoke one session from `/security` and verify it stops working.
- Use logout-all and verify every session is invalid.
- Confirm one-time verification/reset tokens cannot be replayed.

## 8. MFA setup and operational security
1. Deploy and run the migration before switching traffic.
2. Sign in with your existing v5.43 session; the migration does not revoke it.
3. Open `/security` and choose **Set up authenticator MFA**.
4. Confirm your password, then scan the `otpauth://` URI or manually enter the displayed secret in a TOTP app (e.g. Aegis, Google Authenticator, Microsoft Authenticator or 1Password).
5. Save all ten recovery codes offline. They are displayed only once.
6. Enter a current six-digit authenticator code to enable MFA.
7. Enabling MFA revokes all existing sessions; sign in again and complete the MFA challenge.
8. Test one recovery code in a separate private browser, then confirm it cannot be reused.
9. Rotate recovery codes if they may have been exposed. Rotation invalidates every previous recovery code.
10. Keep `SECRET_KEY` stable. TOTP secrets are encrypted using a purpose-derived key from it; changing it makes existing MFA secrets unreadable.

MFA is optional per account in this release. Enforce enrollment for all users only after a separate rollout and recovery policy decision. A standard authenticator app requires no paid API or provider key.

## 9. Authentication policy defaults
```env
LOGIN_FAILURE_LIMIT=8
LOGIN_LOCKOUT_MINUTES=15
MFA_CHALLENGE_MINUTES=5
MFA_CHALLENGE_MAX_ATTEMPTS=5
```
The login rate limiter also applies to MFA endpoints. Failed password and second-factor attempts contribute to the account lockout. MFA challenges are database-backed, expire, have an attempt cap and are single-use. Accepted TOTP time steps cannot be replayed.

## 10. Remaining launch gates
Full backend and frontend CI, live SMTP, PostgreSQL concurrent token replay, staging OAuth, independent security review and backup/restore rehearsal remain required. This package does not claim those external checks have already passed.


## 11. v5.45.0 compatibility
- Existing v5.43 database-backed access sessions remain valid after the migration unless the account enables/disables MFA, changes its password, resets its password or revokes sessions.
- Existing user accounts retain their email verification state.
- `SECRET_KEY` must not be changed as part of this upgrade.
- No external TOTP API key is needed. SMTP remains required when email verification is enabled.


## 12. Break-glass MFA recovery (operator only)
If a verified account owner loses both their authenticator and all recovery codes, first verify their identity outside the application and take a fresh database backup. Then an authorized database operator can disable MFA for that exact account and revoke all its sessions:

```sql
BEGIN;
UPDATE users
SET mfa_enabled = FALSE,
    mfa_secret_encrypted = '',
    mfa_last_used_step = NULL
WHERE email = LOWER('verified-account-email@example.com');

DELETE FROM mfa_recovery_codes
WHERE user_id = (SELECT id FROM users WHERE email = LOWER('verified-account-email@example.com'));

UPDATE mfa_challenges
SET used_at = NOW()
WHERE user_id = (SELECT id FROM users WHERE email = LOWER('verified-account-email@example.com'))
  AND used_at IS NULL;

UPDATE auth_sessions
SET revoked_at = NOW()
WHERE user_id = (SELECT id FROM users WHERE email = LOWER('verified-account-email@example.com'))
  AND revoked_at IS NULL;
COMMIT;
```

This operation disables MFA but does not change the account password or email-verification state. Have the owner complete a password reset through the verified email flow and set up MFA again. Never perform this for an unverified support request; the SQL is a controlled recovery mechanism, not a normal user workflow.


## 13. Cost and free-first guidance for v5.44
- TOTP generation and verification run locally in the backend. No TOTP API key, paid SMS gateway or external MFA SaaS is required.
- Authenticator apps such as Aegis or Google/Microsoft Authenticator can be used; verify current app availability and device backup behavior yourself.
- Recovery codes are generated locally and stored as hashes. Email verification/password reset still require an SMTP provider if enabled.
- Keep `MFA_CHALLENGE_*` and `LOGIN_*` at the conservative defaults unless monitoring supports a reason to change them.
- Free-tier hosting does not guarantee an always-on worker, durable database retention or production SLA. Re-check Render, Neon, Upstash and Vercel current limits/terms. Do not promise a $0 always-on commercial deployment.


## 14. v5.45.0 security and recovery operations
Read `docs/SECURITY_BACKUP_RESTORE_RUNBOOK_5.45.md` before scheduling a backup restore rehearsal. The verification flow requires a distinct disposable database and explicit `ALLOW_NONPRODUCTION_RESTORE=YES`; never use production as the restore target. v5.45 locks the account row for MFA setup/enable/disable/recovery-code rotation. PostgreSQL honors these row locks; SQLite does not. Full PostgreSQL concurrency tests remain a staging/CI gate.
