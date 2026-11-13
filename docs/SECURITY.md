# Security checklist

- Change `SECRET_KEY` before deployment; never use the development default.
- Keep provider keys in server-side environment variables only. Never prefix secrets with `NEXT_PUBLIC_`.
- Use HTTPS in production and exact CORS origins.
- Passwords are bcrypt-hashed; tokens are signed JWTs. Add refresh-token rotation, email verification, password reset, MFA and login throttling before public production.
- Every data query must be scoped to the authenticated user. Review any new endpoint for IDOR.
- RSS ingestion allows HTTPS and can be restricted with `RSS_ALLOWED_DOMAINS`; production should use a strict allowlist and network egress controls to prevent SSRF.
- Job descriptions are untrusted prompt input. Do not let content invoke tools or override system instructions.
- Approval is hash-bound to proposal text. External sending is not implemented.
- Do not store bank credentials, platform passwords, government IDs or payment secrets.
- Add rate limiting, structured redacted logs, dependency scanning, backups and a professional security review before real customer use.


## Production startup checks (v3.0)

When `ENVIRONMENT=production`, API startup rejects configurations that use the
development/default secret, a non-PostgreSQL database, a missing Redis URL, an
HTTP/non-origin frontend URL, wildcard or non-HTTPS CORS origins, or configured
Google/Microsoft OAuth without `OAUTH_ENCRYPTION_KEY`.

Run `cd backend && ENVIRONMENT=production python scripts/production_preflight.py`
before deployment. The preflight reports rule failures only and does not print
secret values. It does not test network connectivity, database credentials,
Redis availability, TLS certificates or provider OAuth callbacks; those still
require deployment-time health checks.


## API abuse controls (3.3)

Production API routes use Redis-backed fixed-window limits. Authentication, AI/search and general routes have separate per-actor counters. Valid bearer tokens are grouped by verified JWT subject; anonymous requests use the direct client IP. Forwarded headers are not trusted unless a separately reviewed trusted-proxy configuration is introduced. Production requests fail closed with HTTP 503 when Redis rate-limit storage is unavailable. Configure the limits in the deployment environment and monitor 429/503 responses. These controls do not replace account quotas, bot detection, WAF protections or a security assessment.
