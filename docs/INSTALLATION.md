# Installation

## Docker (recommended)

1. Install Docker Desktop.
2. `cp .env.example .env` (Windows PowerShell: `Copy-Item .env.example .env`).
3. Replace `SECRET_KEY` with a random value. Example: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
4. Run `docker compose up --build`.
5. Open `http://localhost:3000`; API docs at `http://localhost:8000/docs`.

## Local backend without Docker

1. Install Python 3.12 and PostgreSQL 16, or use SQLite by setting `DATABASE_URL=sqlite:///./freelance_ai.db`.
2. `cd backend`; create venv: `python -m venv .venv`. Activate it (`.venv\Scripts\activate` on Windows; `source .venv/bin/activate` on macOS/Linux).
3. `pip install -r requirements.txt`.
4. Set environment variables from root `.env` and run `uvicorn app.main:app --reload --port 8000` from `backend`.
5. Frontend: `cd frontend`, `npm install`, set `NEXT_PUBLIC_API_URL=http://localhost:8000`, then `npm run dev`.

## Ollama

Install Ollama from https://ollama.com/download, then run `ollama pull qwen2.5:3b`. Ensure the API is reachable at `http://localhost:11434`. In Docker Desktop, the compose file uses `host.docker.internal`. If local inference is too slow, use a smaller model supported by your hardware.


## Release 0.3 background discovery
Docker Compose now starts Redis and a separate RQ worker. Configure at least one enabled RSS source in the app, then use the Sources tab's Queue discovery scan button. The API records each queued job and the worker persists its status and result.

For manual worker execution outside Compose:
```bash
cd backend
python worker.py
```
The worker requires `REDIS_URL`, `DATABASE_URL`, and access to the same database as the API.

## Embedding setup
For local Ollama embeddings:
```bash
ollama pull nomic-embed-text
```
The backend uses the configured `OLLAMA_BASE_URL`. If embedding generation is unavailable, documents are still chunked and indexed for lexical fallback retrieval.


## Release 0.7 multi-source discovery
In the Sources tab, choose `RSS / Atom feed` or `Public JSON jobs API`, enter a permitted HTTPS URL and save it. Then queue discovery. The JSON adapter accepts a top-level list or a list under `jobs`, `results`, `items` or `data`; see `docs/RELEASE_0.7_MULTI_SOURCE_DISCOVERY.md` for field mappings and security limits. Redis and the RQ worker must be running for queued discovery.


## Release 0.8 workflows
After upgrading the database with `alembic upgrade head`, start the Redis service and RQ worker with Docker Compose. From Opportunities, click **Run full AI workflow**. Track its checkpoints in Workflows. The workflow automatically creates a pending approval for the generated proposal; approve/reject it in Approvals. An approved workflow can then be resumed from Workflows. Resuming records approval completion only and never submits the proposal externally.


## Release 0.9 database upgrade
Back up the database before upgrading. From the backend directory run:
```bash
alembic upgrade head
```
This applies `0008_source_health` and `0009_evidence_provenance`. Existing sources receive `unknown` health and zero failure/item counters. Existing research records receive blank source host and evidence hash; only newly recorded evidence receives a calculated digest. Then rebuild/restart the API and worker so both use the updated models:
```bash
docker compose up --build -d
```


## Release 1.0
No database migration is required for v1.0. After deploying the updated API and frontend, use the Opportunities tab's **Smart rank opportunities** control. The ranking is calculated from existing opportunity and feedback records.


## Release 1.2
No database migration is required for v1.2. Pricing recommendations and project profitability are computed from existing opportunity, profile, proposal, feedback, project, invoice and time-entry records. Update API and frontend together, then run the frontend checks described in `docs/RELEASE_1.2_VERIFICATION.md`.


### Upgrade to v1.3
After updating the code and environment, run `cd backend && alembic upgrade head` (or run the equivalent migration command in the API container). This applies migration `0011_email_intake`. Back up PostgreSQL before upgrading.


## Optional Gmail / Outlook integration (v1.4)

The core platform still works without email OAuth. To enable real mailbox sync and approved replies:

1. Create an OAuth application in Google Cloud Console or Microsoft Entra.
2. Configure the provider's OAuth consent screen and request only the scopes shown below.
3. Register the exact callback URI:
   - Google: `https://YOUR_API_HOST/api/v1/email-integrations/callback/google`
   - Microsoft: `https://YOUR_API_HOST/api/v1/email-integrations/callback/microsoft`
4. Generate an encryption key:
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
5. Add the following variables to the backend environment (Render environment settings or `.env`):
   ```env
   OAUTH_ENCRYPTION_KEY=YOUR_GENERATED_FERNET_KEY
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REDIRECT_URI=https://YOUR_API_HOST/api/v1/email-integrations/callback/google
   MICROSOFT_CLIENT_ID=
   MICROSOFT_CLIENT_SECRET=
   MICROSOFT_TENANT_ID=common
   MICROSOFT_REDIRECT_URI=https://YOUR_API_HOST/api/v1/email-integrations/callback/microsoft
   ```
6. Restart/redeploy the API. In the application Inbox tab, choose Connect Gmail or Connect Outlook and complete provider consent.
7. Use Sync inbox to import recent mail. Review the imported message, create/edit a reply, request approval, approve it, and then deliberately select Send approved email.

Requested delegated scopes:
- Google: `openid`, `email`, `gmail.readonly`, `gmail.send`.
- Microsoft: `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`.

Never paste client secrets or encryption keys into chat, GitHub, frontend environment variables, or the ZIP. For production, use a unique strong encryption key and back it up securely: losing it makes stored tokens undecryptable. Google revocation is attempted on disconnect. For Microsoft, also remove the app's consent from Microsoft account security/app permissions. Provider OAuth can require verification/admin approval depending on account type and requested scopes.


## Release 1.5 migration and communication intelligence

The v1.5 release adds migration `0013_communication_intelligence` after `0012_email_provider_oauth`. Back up the database, deploy the new API and allow the existing startup migration process to apply it. New fields store explainable message indicators and draft context metadata.

Contextual reply drafting reuses your existing portfolio documents. For semantic retrieval, configure your existing `EMBEDDING_PROVIDER` and embedding model; if embedding calls are unavailable or exceed the short generation-time budget, lexical retrieval is used. AI drafting uses the configured `AI_PROVIDER`; if it is unavailable, the application saves a safe clarification-oriented template instead.

No additional API key is mandatory if you use your already-configured local Ollama setup. Follow-up reminders are in-app only and require an explicit user action. Project suggestions also require explicit confirmation.


## Database upgrades
For incremental releases, back up the database and run `cd backend && alembic upgrade head`. Never reset an existing production database to apply a release migration. v1.7 adds revision `0015_delivery_finance`.


## v1.8 analytics migration
Back up the database and run `cd backend && alembic upgrade head`. Revision `0016_project_opportunity_attribution` adds an optional project-to-originating-opportunity link. Existing projects remain valid and unlinked.


## v2.1 — Grounded AI Business Coach
After updating to v2.1, back up the database and run `cd backend && alembic upgrade head` to apply revision `0018_grounded_business_coach`. Configure the existing `AI_PROVIDER` settings (Ollama by default or optional OpenAI) to enable model-generated answers. The coach page is `/coach`; it also has a deterministic fallback when the configured model is unavailable. Install frontend dependencies and run the usual typecheck/build before deploying.


## Release 5.31.0 — Deliverable revision-origin tracking

Before deploying v5.31.0, back up the database and run `cd backend && alembic upgrade head`. This applies `0035_deliverable_revision_origin`. Existing non-initial revision history is intentionally retained as `unclassified`; do not manually bulk-label historical revisions based on dates or client feedback timing. New revision origins are captured in the Delivery workspace. See `docs/UPGRADE_5.30_TO_5.31.md`.

### v5.33.0 upgrade
Back up the database, deploy the updated source, then run `cd backend && alembic upgrade head`. Migration `0037_delivery_audit_hash_chain` backfills existing delivery audit events and enables per-project chain verification. See `UPGRADE_5.32_TO_5.33.md`.

### v5.34.0 upgrade

Back up PostgreSQL, deploy the v5.34.0 source, then run `cd backend && alembic upgrade head`. Migration `0038_delivery_issue_workflow` creates the delivery issue and corrective-action table and indexes. It retains prior delivery audit history. Restart the API and frontend after the migration. See `docs/UPGRADE_5.33_TO_5.34.md` for the operational walkthrough.
