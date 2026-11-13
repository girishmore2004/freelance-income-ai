# Upgrade Freelance Income AI 5.9.0 → 5.10.0

## What changed

- Proposal generation now retrieves relevant portfolio chunks from the authenticated user's own portfolio documents.
- Hybrid retrieval is used when query embeddings are available; lexical retrieval remains the fallback.
- `GET /api/v1/proposals/intelligence/{opportunity_id}` previews relevant evidence and exposes document/chunk provenance, coverage and limitations.
- `POST /api/v1/proposals/generate` includes a `grounding` object in its response.
- Proposal prompts explicitly prohibit unsupported project, client, metric, certification and outcome claims. Job descriptions remain untrusted input.
- The existing proposal table and approval fingerprint remain unchanged. No database migration is required.

## Deploy

1. Back up the repository and database.
2. Replace application files with this release while preserving `.env`, uploads and deployment secrets.
3. Install backend dependencies from `backend/requirements.txt`.
4. Run backend tests and frontend typecheck/build in CI or staging.
5. Deploy backend and frontend together.
6. Upload at least one portfolio case study, open an opportunity, inspect its portfolio evidence, then generate and review a proposal.
7. Confirm that evidence references are scoped to the signed-in user and that the approval flow still binds the exact proposal content and price.

## Compatibility

- Additive API change: generated proposal responses now include `grounding`. Existing proposal fields are unchanged.
- New read-only endpoint: `/api/v1/proposals/intelligence/{opportunity_id}`.
- No migration or new environment variable.
- Embedding quota exhaustion or provider failure falls back to lexical retrieval.
- External messages and marketplace applications remain human-approved/manual.
