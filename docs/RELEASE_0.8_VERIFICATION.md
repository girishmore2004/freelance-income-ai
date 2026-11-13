# Release 0.8 verification

## Automated checks
Run in the backend virtual environment after installing all pinned requirements:
```bash
cd backend
python -m pip install -r requirements.txt
alembic upgrade head
pytest -q
python -m compileall -q app
```

The workflow-specific tests cover graph stage registration, checkpoint JSON serialization and skipping previously completed stages. The workflow API test covers creation and user-scoped access; run it with the full dependencies installed.

## Frontend and containers
```bash
cd frontend
npm ci
npm run typecheck
npm run build
cd ..
docker compose config
docker compose build
docker compose up -d
```

## Manual workflow acceptance test
1. Register and complete the professional profile.
2. Add a permitted opportunity.
3. In Opportunities, choose **Run full AI workflow**.
4. Confirm the workflow progresses through matching, research, pricing and proposal stages.
5. Confirm a proposal and pending approval are created.
6. Stop/restart the worker during a test run and retry a failed or stale-running workflow. Confirm completed stages are restored from SQL checkpoints and skipped.
7. Edit the proposal after an approval request and confirm the old approval hash cannot approve the edited proposal.
8. Approve the exact current proposal; confirm the workflow changes to `approved`.
9. Resume the workflow; confirm it becomes `completed` and returns `external_submission=not_performed`.
10. Reject another workflow and confirm it becomes `rejected` without a resume option.
11. Use a different user account and confirm workflow IDs are not accessible across users.

## Verification performed while preparing this archive
- Python source AST parsing: checked.
- JSON and Docker Compose syntax: checked.
- Existing focused service tests: executed (25 passed).
- Workflow-specific tests were added but could not be executed in this packaging runtime because `langgraph` and `pgvector` are not installed here. Install `backend/requirements.txt` before treating workflow tests as verified.
- Full API integration tests, PostgreSQL migration execution, frontend dependency installation/build and Docker image build were not run in this packaging runtime.
