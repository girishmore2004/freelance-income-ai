# Known Issues

| ID | Severity | Issue | Plan |
|---|---|---|---|
| K-01 | High | 12 of 13 frontend pages depend on Python routes that are not deployed; about 100 route references fail in production. | Decision D-11, then port or hide per page behind flags. |
| K-02 | High | Browser token still in `localStorage` until pages migrate to `frontend/lib/api-client.ts` and `NEXT_PUBLIC_AUTH_MODE=cookie`. API side is ready. | Phase 0 batch 2. |
| K-03 | Medium | Edge has no general per-route rate limiting (`RATE_LIMIT_*` vars are unused on Edge); login lockout and the email cooldown exist. | Phase 1: Cloudflare Rate Limiting binding or Durable Object counter. |
| K-04 | Medium | MFA TOTP secrets (both services) are encrypted with a key derived from `JWT_SECRET`/`SECRET_KEY`; rotating it locks MFA users out. | Add `MFA_ENCRYPTION_KEY` with dual-key read in both services. |
| K-05 | Medium | Python AI calls are not under the new global budget (Python is not deployed, so no current spend). | Apply the same governor if Python is ever hosted. |
| K-06 | Low | Two near-identical MFA modules on Edge (`mfa.ts`, `mfa-service.ts`). | Consolidate onto `mfa.ts`. |
| K-07 | Low | Edge repo still carries stale copies of the Python backend and frontend. | Remove after ADR-001 is confirmed in practice. |
| K-08 | Low | Two Gmail integration stores exist (Python `email_provider_connections`, Edge `integrations`). | Pick one when D-11 is decided. |
| K-09 | Info | Proxy forwards bodies up to 12 MB; Edge has no file upload routes yet. | Revisit with R2 uploads (Phase 3). |
| K-10 | Info | `password-service.test.ts` could not run offline (needs `bcryptjs`). | CI covers it. |
