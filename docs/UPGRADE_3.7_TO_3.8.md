# Upgrade 3.7 to 3.8

1. Back up the repository and database.
2. Extract v3.8 over the existing repository. Preserve `.git`, `.env`, and deployment settings.
3. No schema migration or new environment variables are required.
4. Deploy using the existing CI pipeline.
5. Run the tenant-isolation route tests in CI against the configured test database.
6. Verify the owner can access their own records and a second account receives 404/empty results for cross-account references.
7. Keep all external actions approval-gated. These tests do not send emails, submit marketplace proposals, deliver client work, or move money.
