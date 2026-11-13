# Release 4.1.0 verification report

## Build-time checks
- Source archive: v4.0.0.
- Five focused lifecycle API regressions added.
- Backend database engine now honors the CI-provisioned `TEST_DATABASE_URL` in non-production test runs; the full-CI workflow migrates that same PostgreSQL/pgvector database before running pytest.
- Python source compilation: see package build result.
- ZIP CRC and source manifest hashes: see final package verification.
- No `.env`, local node_modules, Python bytecode or pytest cache is included.

## New regression coverage
1. Marketplace application: proposal attachment, approval hash required, cross-user approval denied, manual submission reference recorded, status changes audited, audit hidden from other account.
2. Invoice schedule: issue blocked before approval, incorrect approval hash rejected, cross-user approval/issue denied, one unpaid invoice record created, duplicate issue blocked.
3. Deliverable: cross-user review denied, review hash required, internal approval required before manual delivery record, client acceptance recorded, delivered/accepted edits locked.
4. Workflow: cross-user resume denied, current proposal approval required, resume checkpoint persisted, external submission remains unperformed.

## Local execution limitation
The current build runtime does not contain `python-jose`, `passlib` or `pgvector`; consequently the FastAPI API regression module could not be executed locally in this environment. The new tests are included in the repository and are automatically discovered by the existing GitHub Actions full-CI `pytest -q` job, which installs `backend/requirements.txt` and provisions PostgreSQL with pgvector and Redis. Do not treat the new API tests as locally passed until CI executes them.

## Not performed
- No production deployment, live provider integration, marketplace submission, email sending, client delivery or payment.
- No live Redis outage/recovery test, multi-worker stress test, k6 baseline, backup/restore drill or human-reviewed RAG benchmark.
- No production security certification.
