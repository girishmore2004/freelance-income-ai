# Release 0.2 upgrade

Added project tasks and milestones, client research evidence records, portfolio document extraction and lexical cosine retrieval, invoice PDF export, Telegram test notification, authenticated n8n webhook, saved RSS source management and scheduled n8n-triggered RSS discovery, feedback aggregation, specialist registry, expanded LangGraph scoring/research/pricing workflow, Alembic baseline and tests.

## Explicit limitations
- Research facts are user-provided; autonomous client verification is not implemented.
- Portfolio search uses lexical TF/cosine similarity, not pgvector or learned embeddings.
- Text-based PDF extraction only; OCR for scanned PDFs is not implemented.
- Outreach remains disabled; approval prepares a draft for manual submission only.
- No payment collection, transfer or marketplace auto-application.
- n8n event receiver is implemented; workflows need credentials and a running n8n instance.
- Graph does not yet use durable Postgres checkpoints or async queue workers.
