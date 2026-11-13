# Freelance Income AI v5.43.0 — deployment guide

## 1. Release contents
- Email verification and resend.
- Enumeration-safe password reset.
- Password change and revocable database-backed sessions.
- Account security page at `/security`.
- Migration `0044_account_security`.

## 2. Before deployment
1. Download and extract the v5.43.0 ZIP.
2. Back up the production PostgreSQL database and retain a tested restore point.
3. Confirm Render API, Render worker and Vercel frontend are connected to the same release commit.
4. Configure all backend secrets in Render only. Do not commit `.env`.

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

Expected Alembic head: `0044_account_security`.

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
- `/health` reports version `5.43.0`.
- `/ready` returns ready after migration and service checks.
- Register a test account; verify the email.
- Try login before verification (must be rejected) and after verification (must succeed).
- Request password reset for a known and an unknown email; response text/status should be the same.
- Reset password; old password must fail and prior sessions must be revoked.
- Sign in from two browsers; revoke one session from `/security` and verify it stops working.
- Use logout-all and verify every session is invalid.
- Confirm one-time verification/reset tokens cannot be replayed.

## 8. Important compatibility note
Existing v5.42 bearer tokens do not contain a persisted session `jti` and are rejected by v5.43 authentication. All users must sign in again after deployment. User accounts that existed before the migration are marked email-verified to avoid locking out existing users.

## 9. Remaining launch gates
Full backend and frontend CI, live SMTP, PostgreSQL concurrent token replay, staging OAuth, independent security review and backup/restore rehearsal remain required. This package does not claim those external checks have already passed.
