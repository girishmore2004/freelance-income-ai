# Upgrade 2.2 to 2.3

1. Back up the database and current repository.
2. Merge the v2.3 project files into the existing repository; retain deployment secrets and `.env` values.
3. No Alembic migration is required.
4. Install backend dependencies from `backend/requirements.txt`.
5. Run the focused retrieval tests documented in `RELEASE_2.3_VERIFICATION.md`.
6. Install frontend dependencies and run the existing typecheck/build scripts.
7. Deploy API and frontend using the existing Render/Vercel configuration.
8. Upload a sample portfolio document and test `/api/v1/portfolio/search` and `/api/v1/coach/ask` with questions whose answers are present in that document.

Embedding failures are expected to degrade to lexical retrieval. Do not treat a successful fallback as proof that semantic retrieval is operating.
