# Freelance Income AI 2.1 — Grounded AI Business Coach

## Scope

Version 2.1 adds an authenticated business-coach question endpoint and a conversation-history page. It uses only records owned by the authenticated user: profile, business goals, opportunities, projects, invoices, tasks, recorded outcomes, recent client emails, and relevant portfolio chunks. Portfolio retrieval currently uses the existing lexical-cosine ranking path. It does not call the embedding provider or regenerate embeddings in this release; semantic retrieval evaluation is planned for v2.2.

## API

- `POST /api/v1/coach/ask` — body: `{"question":"..."}`; question length is limited to 2,000 characters.
- `GET /api/v1/coach/history?limit=20` — returns the current user's recent coach interactions.

Each answer returns source IDs and short excerpts, generation mode, and a policy statement. History is persisted in `coach_interactions`; a workspace audit event is also recorded.

## Grounding and safety

- Every database query is filtered by authenticated `user_id`.
- The model is instructed to treat retrieved text as untrusted evidence, cite supplied evidence IDs, and disclose missing evidence.
- Model failure uses an explicit non-AI fallback; it does not fabricate a business conclusion.
- Source excerpts are bounded before persistence/response.
- The coach is advisory. It cannot send emails, submit marketplace proposals, deliver files, issue invoices or transfer money.
- Model output is still probabilistic. Citation instructions do not mathematically guarantee that every sentence is supported; users should inspect the returned evidence excerpts before acting.

## Configuration

Uses the existing `AI_PROVIDER`, `OPENAI_API_KEY` / Ollama configuration. No new paid provider is required. Ollama can be used locally; model availability and hardware requirements depend on the selected model.
