## Current release guide

For the complete v5.41.0 GitHub, environment, free-tier, Neon/Redis, Render, frontend, worker and migration sequence, follow [FINAL_DEPLOYMENT_GUIDE_5.41.md](FINAL_DEPLOYMENT_GUIDE_5.41.md). This older guide is retained as a short reference. Render Free does not provide a free Background Worker; see the current guide for prototype alternatives.

# GitHub and free-tier deployment guide

## Push to GitHub

1. Create an empty repository on https://github.com/new.
2. In this folder run:

```bash
git init
git add .
git status   # confirm .env is NOT listed
git commit -m "Initial Freelance Income AI release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/freelance-income-ai.git
git push -u origin main
```

## Database: Neon

1. Create a project at https://neon.com/.
2. Copy its pooled or direct connection string.
3. Convert it to SQLAlchemy psycopg format: `postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require`.
4. Save it as `DATABASE_URL` in the backend host.
5. Neon free allowances and limits can change; monitor the Neon dashboard and export backups regularly.

## Backend: Render

1. Create a new Web Service from the GitHub repository.
2. Set Root Directory to `backend`.
3. Runtime: Docker; Dockerfile path `./Dockerfile`.
4. Add `DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT=production`, `CORS_ORIGINS=https://YOUR-VERCEL-DOMAIN`, `AI_PROVIDER=ollama` (or `openai`), and model variables.
5. Deploy and test `/health` and `/docs`.
6. Free Render services sleep after inactivity and have ephemeral local filesystems. Do not use local SQLite or local file uploads for hosted persistence. Render free Postgres currently expires after 30 days, so this guide uses Neon instead.

## Frontend: Vercel

1. Import the GitHub repository in Vercel.
2. Set Root Directory to `frontend`.
3. Framework: Next.js.
4. Set `NEXT_PUBLIC_API_URL` to your Render API base URL (no trailing slash).
5. Deploy.
6. Add the exact Vercel URL to backend `CORS_ORIGINS`, then redeploy backend.

## Free-tier caveats

- Vercel Hobby is intended for personal/non-commercial use; verify its terms for your intended use.
- Render free web services spin down when idle and can restart; no persistent disk is available.
- Neon quotas are limited and may change.
- Ollama is not hosted by these services. For local model inference, run a local worker/agent service on your own machine. Never expose Ollama's unauthenticated local port publicly.
- This stack is suitable for a personal prototype, not guaranteed always-on production. Check provider pricing and terms before deployment; free plans change.


## v5.41.0 deployment note

For the complete current environment-variable inventory, Groq-compatible free inference setup, lexical retrieval option, worker deployment, migration order, first-account lockdown and production gaps, follow `docs/FINAL_DEPLOYMENT_GUIDE_5.41.md`.

Do not assume every service can be free: Render Background Workers have no free compute plan, Render Free Postgres expires after 30 days, and Vercel Hobby is personal/non-commercial only. The complete guide distinguishes a $0 prototype from a commercial deployment.
