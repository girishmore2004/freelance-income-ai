# Controlled load testing

The k6 script `ops/load/k6_smoke.js` makes read-only requests to `/health`. It does not create accounts, write records or call AI providers.

Install k6 using its official installation instructions, then run:

```bash
API_BASE_URL=https://YOUR-STAGING-API k6 run ops/load/k6_smoke.js
```

The default profile ramps from 2 to 5 virtual users for a short smoke run. Thresholds are initial guardrails, not measured capacity guarantees. Run only against an environment you own or are authorized to test. Do not run against public marketplaces or third-party services.

For authenticated route testing, set `API_TOKEN` to a dedicated staging test account token. Tokens may be visible in process environments and shell history; prefer a temporary CI secret and revoke it after testing. The script intentionally does not print the token.

This release does not claim a load-test result or implement distributed API rate limiting. Rate limiting, per-user quotas, and abuse monitoring remain production hardening priorities.
