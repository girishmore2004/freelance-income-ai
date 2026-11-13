# Upgrade 3.6 to 3.7

1. Back up the repository and database.
2. Extract v3.7 over the existing repository; preserve `.git`, `.env`, and deployment settings.
3. No schema migration or new environment variables are required.
4. Keep the existing Redis configuration enabled for request-rate limiting and RQ workers.
5. Deploy through the existing CI pipeline.
6. Verify an authenticated agent workflow request increments `GET /api/v1/usage/ai` and `/api/v1/usage/ai/report`.
7. Verify idempotent replay does not create another usage event.
8. Verify quota exhaustion returns HTTP 429 before creating a new workflow.

Agent workflow usage is counted as one initiated workflow operation. It is not a token count, model-call count, or cost estimate. Failed queue submissions may still count as an attempted operation.
