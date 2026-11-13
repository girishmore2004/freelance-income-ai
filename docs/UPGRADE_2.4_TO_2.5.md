# Upgrade 2.4 to 2.5

1. Back up the v2.4 repository and PostgreSQL database.
2. Merge the v2.5 ZIP contents into the existing repository. Keep `.env`, OAuth credentials and deployment secrets.
3. Install backend dependencies: `cd backend && pip install -r requirements.txt`.
4. No new database migration is required in v2.5; it extends the existing workflow state/result JSON and trace payload.
5. Ensure Redis and the existing worker are running: `cd backend && rq worker freelance-income-ai`.
6. Install frontend dependencies and verify: `cd frontend && npm ci && npm run typecheck && npm run build`.
7. Deploy the backend on Render and frontend on Vercel using the existing configuration.
8. Sign in, open `/agent-workflows`, start a `business_review`, and inspect the proposal and communication outputs.
9. Verify that proposal previews remain previews and email plans do not create or send messages. Use the existing proposal/email UI when you want to create editable records and request approval.

If your current deployment has a long-running v2.4 workflow, allow it to finish before deploying the new worker code. Do not delete existing workflow records or checkpoint tables.
