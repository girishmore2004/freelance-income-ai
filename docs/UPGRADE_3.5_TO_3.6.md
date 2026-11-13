# Upgrade 3.5 to 3.6

1. Back up the database and repository.
2. Extract v3.6 over the existing repository, preserving `.git`, `.env`, and deployment settings.
3. No Alembic migration or new environment variables are required.
4. Deploy the backend and frontend using the existing pipeline.
5. Verify authenticated `GET /api/v1/usage/ai/report?days=30`.
6. Review abuse-event retention in dry-run mode before considering `--apply`.

Existing AI quotas, Redis rate limits, approval gates, and external-action safeguards are retained.
