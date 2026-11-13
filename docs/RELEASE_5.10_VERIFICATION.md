# Release 5.10.0 verification — portfolio-grounded proposal intelligence

## Implemented

- Tenant-scoped portfolio retrieval using existing `PortfolioChunk` records.
- Hybrid retrieval with existing RRF/MMR helper and lexical fallback.
- Evidence preview endpoint and grounding metadata in proposal generation response.
- Proposal prompt hardening against unsupported experience claims and untrusted job-description instructions.
- Frontend controls to inspect retrieved portfolio sources and view grounding metadata after generation.
- No schema migration and no external side effects.

## Checks actually executed in this packaging environment

- Python `compileall` for backend application and tests: **PASS**.
- Focused proposal-intelligence, risk-aware-ranking and retrieval tests: **14 passed**.
- Release ZIP CRC and per-file SHA-256 verification: **PASS** (380 source files).
- Backend application import: **BLOCKED** because `pgvector` is not installed in this environment.
- Frontend TypeScript typecheck/build: **BLOCKED** because `frontend/node_modules` is absent; global `tsc` reports missing React, Node and Playwright type packages. No dependency install could be validated here.
- PostgreSQL integration, multi-tenant endpoint integration and browser E2E: **NOT RUN**.

## Safety and limitations

- Retrieved portfolio material is user-supplied and not independently verified.
- Similarity and coverage are retrieval indicators, not factual proof.
- Human review remains mandatory before proposal approval or external submission.
- No marketplace submission or outbound client communication is performed by this release.
- Do not promote to production until CI installs the pinned dependencies and completes backend tests, frontend typecheck/build, PostgreSQL integration and staging smoke tests.
