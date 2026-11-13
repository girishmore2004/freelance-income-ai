# Release-readiness gap review — v5.41.0

This is a source/configuration review, not a penetration test or production certification.

## Implemented and included

- Opportunity discovery through manual records, permitted feeds and the implemented official Upwork read-only API adapter (requires provider approval and credentials).
- Profile/portfolio matching, proposal drafting and deterministic proposal review.
- Human approval gates for marketplace applications, email sending, handover, project closure and financial actions.
- Client/project delivery management, task scheduling, deliverables, revision evidence, closeout, archive manifests, archive bundles and recovery rehearsal records.
- Invoice and payment ledger tracking from user-entered events.
- AI generation through Ollama or an OpenAI-compatible chat-completions endpoint; embeddings through Ollama/OpenAI or explicit lexical-only mode.
- PostgreSQL migrations, Redis/RQ worker, rate limiting, usage quotas, GitHub CI and deployment scripts.

## Known functional gaps (do not represent these as implemented)

1. **Scanned-document OCR:** scanned PDFs/images are not OCR-processed. Current document extraction supports text-based PDF/TXT/MD only.
2. **Marketplace coverage:** Upwork supports official read-only search only and requires approved API access. Freelancer is registered as a disabled adapter; Fiverr, LinkedIn and Contra do not have live provider adapters in this release. Do not scrape sites or automate submissions.
3. **Payment processing and banking:** no payment gateway, bank account sync or automated payment collection is connected. Invoice/payment records and receipts are manually entered.
4. **Cloud AI costs:** local Ollama is no per-token API charge but requires hardware and network access. Cloud inference is not included for free. `EMBEDDING_PROVIDER=lexical` avoids remote embedding charges but reduces semantic retrieval capability.
5. **Background worker on free hosting:** Render Free does not provide a free Background Worker instance. RQ jobs require a separate worker process; run one on an always-on machine for a prototype or pay for a worker. GitHub Actions scheduled discovery is not a general RQ worker.
6. **Authentication hardening:** the current auth flow uses password login and signed access tokens. Email verification, password-reset workflow, MFA and self-service session revocation are not included. For a single-owner prototype, disable public registration immediately after creating the owner account. Do not open public registration for a commercial multi-user launch without adding and testing these controls.
7. **Frontend lockfile:** the repository does not currently contain `frontend/package-lock.json`. CI uses `npm install`, not `npm ci`; create and commit a lockfile in a network-enabled development environment before strict reproducible production builds.
8. **External evidence:** archive checks verify reference strings and their hashes, not the bytes, identity or legal authenticity of external files.
9. **Recovery:** recovery rehearsal entries are operator-reported checklists. The application does not run database backups/restores or independently verify the restore environment.
10. **Monitoring:** provider logs and health/readiness endpoints are available; a complete external metrics, tracing, alerting and incident-management setup is not bundled.

## Mandatory deployment gates

- Run the full GitHub Actions `Full CI` workflow on the exact release commit. It installs dependencies and runs backend tests against PostgreSQL + pgvector and Redis, frontend typecheck/build and Playwright tests.
- Review Python and npm dependency audit artifacts; resolve or formally accept all high/critical findings.
- Run migration `0043_archive_bundle_and_supersession` against a disposable PostgreSQL + pgvector database first.
- Test API `/health` and `/ready`, actual Redis/RQ enqueue/dequeue, login, CORS, AI generation and embedding/lexical fallback on staging.
- Complete a PostgreSQL backup and actual restore to an isolated database. A checklist entry alone is not proof.
- Verify the ZIP bundle's `SHA256SUMS.txt` after download and transfer.
- Keep public registration disabled after owner onboarding.
- Confirm no third-party action happens without explicit human approval.

## Launch recommendation

v5.41.0 is a packaged deployment candidate for a controlled personal/staging rollout. It is **not certified production-ready** until the mandatory gates above pass on your actual hosting providers. For a commercial multi-user service, address authentication hardening, monitoring, backup/restore, stable worker hosting, marketplace permissions and OCR requirements before promising those capabilities.
