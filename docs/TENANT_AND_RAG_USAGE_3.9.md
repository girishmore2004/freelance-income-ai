# Tenant boundaries and portfolio RAG usage — 3.9

## Tenant regression tests
Added two-account API tests for marketplace application listing and audit access, marketplace settings isolation, email provider account listing, deliverable revision history, invoice schedule approval, and durable workflow checkpoint visibility. Email tokens must never appear in API responses.

## RAG/embedding usage accounting
Portfolio document embedding and semantic-search embedding now use the existing per-account quota gate. A successful non-empty embedding records one usage event. This is not a token count or monetary cost. If embeddings are unavailable or quota is exhausted, lexical retrieval remains available.

Operation labels:
- `portfolio_embedding` — one successful document upload embedding operation (document-level accounting).
- `portfolio_search_embedding` — one successful semantic query embedding.

## Tenant query hardening
Deliverable revision counting and delivery-summary revision aggregation explicitly include the authenticated user ID in addition to the owner-scoped deliverable parent.

## Known gaps
OAuth state replay/expiry still needs a dedicated provider-mocked integration test. Marketplace connection/application lifecycle, AgentWorkflowCheckpoint owner-boundary tests, PostgreSQL concurrent access, and the full end-to-end journey still require CI/staging verification.
