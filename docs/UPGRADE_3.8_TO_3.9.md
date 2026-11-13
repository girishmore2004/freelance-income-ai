# Upgrade 3.8 to 3.9

1. Back up the repository and database.
2. Extract v3.9 over the existing repository; preserve `.git`, `.env`, and deployment settings.
3. No database migration or new environment variables are required.
4. Existing AI quota settings remain in force. Portfolio embedding and semantic-search attempts now use the existing per-account quota gate.
5. Deploy through the existing CI pipeline.
6. Run the v3.9 tenant API tests in CI with all backend requirements installed.
7. Confirm one account cannot access another account's marketplace applications, email integration metadata, deliverable revisions, invoice schedules, or workflow checkpoints.
8. Verify portfolio upload/search retains lexical fallback when embeddings are unavailable, and records usage only when an embedding is actually returned.

This release does not call marketplace APIs, submit proposals, send emails, deliver client work, or move money.
