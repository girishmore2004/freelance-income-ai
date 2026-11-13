# Release 0.4 verification checklist

Run from the repository root:

```bash
cd backend
python -m pip install -r requirements.txt
pytest -q
python -m compileall -q app
cd ..
docker compose config
docker compose build
docker compose up -d
docker compose logs -f api worker
```

Then verify:
1. `GET /health` returns `{"status":"ok", ...}`.
2. Register/login and save a profile.
3. Upload a PDF or text portfolio document.
4. Confirm the response reports chunks and embedded chunk count.
5. Search the portfolio with a question grounded in the uploaded file.
6. Confirm PostgreSQL retrieval reports `pgvector_cosine` when vectors exist.
7. Stop Ollama and repeat search; lexical/JSON fallback should still return results.
8. Enqueue RSS discovery and inspect `/api/v1/background-jobs`.
9. Generate a proposal, edit it, request approval, and confirm stale approval is rejected.
10. Confirm no external marketplace submission occurs without explicit human approval.

Do not mark the release production-ready until all checks above pass in the target environment.
