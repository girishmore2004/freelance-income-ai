# Freelance Income AI

An AI-assisted freelancing platform that **finds work for you, prepare everything, and waits for your approval**. You stay the final decision-maker. Nothing is sent to a client without you approving it.

```
AI finds → AI scores → AI drafts → YOU approve → you apply → track → win → deliver → get paid
```

## Live URLs

| | URL |
|---|---|
| **Frontend (open this)** | https://freelance-income-ai.girishmore097.workers.dev |
| **Backend API** | https://freelance-income-ai-api-edge.girishmore097.workers.dev |
| API base path | `/api/v1` (for example `/api/v1/dashboard`) |

The frontend's build variable `NEXT_PUBLIC_API_URL` must equal the backend URL, and the backend's `CORS_ORIGINS` must equal the frontend URL.

---

Everything runs on **Cloudflare** (frontend Worker + edge API Worker) with a **Neon Postgres** database. No other host is needed.

---

## 1. How it works (the flow)

| Step | Who | What happens |
|---|---|---|
| 1. Profile | You | Fill in name, headline, bio, skills, hourly rate, preferred work types. |
| 2. Find work | AI | The discovery agent reads free public job feeds (Remotive, Jobicy), keeps only jobs that match your skills and work type, and scores each 0-100. |
| 3. Draft | AI | For strong matches (score 60+), a proposal is drafted automatically using Workers AI. |
| 4. Approve | You | Review, edit, and approve the proposal. Editing after a request invalidates the old approval. |
| 5. Send | Agent | You tap **Approve & send**. The agent sends it: a Freelancer.com bid through the official API, or an email from your Gmail when the lead lists a contact email. Other leads show a Copy proposal button and a link to the original page. |
| 6. Replies | Agent + You | The agent reads replies (every 6 hours or on **Check for replies now**), labels each one (interested, question, negotiating, rejected), summarises it and suggests a reply. You edit it and tap **Send reply**. |
| 7. Deliver | You | Marking a job **won** creates a project with 5 starter tasks. |
| 8. Get paid | You | Record invoices and mark them paid. The dashboard shows pending revenue. |

The agent runs when you press **Find work now** and automatically every 6 hours (cron). It uses one search term per run (rotating through your skills) to stay inside the public APIs' rate limits.

### Safety rules
- The agent sends only proposals you approved, and only once per proposal. A limit of 10 applications per 24 hours protects your reputation.
- Replies are suggested, never sent without your tap.
- Upwork, Fiverr and LinkedIn are never automated.
- No external action happens without approval.
- A proposal is approved only if it is unchanged since approval was requested (sha256 fingerprint of content, price and currency).
- Marketplaces that forbid scraping (Upwork, Fiverr, LinkedIn) are **not** scraped.
- Remotive and Jobicy are public APIs. Their canonical job URLs and attribution are kept.

---

## 1b. Where projects come from

| Source | Kind | Access | Notes |
|---|---|---|---|
| **Freelancer.com** | Real bid-able projects with budgets | Official API | Optional secret `FREELANCER_TOKEN` (sent as `freelancer-oauth-v1`) if the API asks for one. |
| **Hacker News** "Freelancer? Seeking freelancer?" | Direct client posts | Algolia API | Only top-level "SEEKING FREELANCER" posts are kept. |
| **Reddit r/forhire** | Small client posts | Public JSON listing | Only `[Hiring]` posts are kept. Reddit may block some servers, which only disables this source. |
| Remotive, Jobicy, RemoteOK, Himalayas | Job boards | Public APIs | Only freelance/contract/part-time listings pass (full-time only if you list it). Turn them all off with `INCLUDE_JOB_BOARDS="false"`. Links back and credit are kept. |
| Any other lead (Upwork, Fiverr, LinkedIn, Guru, PeoplePerHour) | Marketplaces | **Not scraped** (their terms forbid it) | Browse them yourself and add the lead with **Add opportunity**. The AI scores it and drafts the proposal. |

Each source runs on its own. If one fails, the others still work, and the run summary in the Agents tab shows which one failed.

---

## 2. Architecture

```
Browser
   │
   ▼
Frontend Worker  (Next.js via OpenNext)         → branch: main
   │  fetch  NEXT_PUBLIC_API_URL
   ▼
Edge API Worker  (TypeScript)                   → branch: cloudflare-edge-api-phase1
   ├─ Hyperdrive ──► Neon Postgres (68 tables)
   ├─ Workers AI   (@cf/meta/llama-3.1-8b-instruct) for proposal drafts
   ├─ Cron  0 */6 * * *  → scheduled discovery
   └─ Queue freelance-income-ai-jobs (bound, reserved for background jobs)
```

| Piece | Cloudflare name |
|---|---|
| Frontend Worker | `freelance-income-ai` |
| API Worker | `freelance-income-ai-api-edge` |
| Database pooling | Hyperdrive config (id in `backend/edge-api/wrangler.jsonc`) |
| Queue | `freelance-income-ai-jobs` |

---

## 3. Repository layout

One repo: `girishmore2004/freelance-income-ai`

| Branch | Built by | Contains |
|---|---|---|
| `main` | Frontend Worker | `frontend/` (Next.js app) and this README |
| `cloudflare-edge-api-phase1` | API Worker | `backend/edge-api/` (TypeScript API) |

```
frontend/app/
  page.tsx          Main app: login, sidebar, all tabs
  globals.css       Styles (sidebar, topbar, cards, chips, responsive drawer)
  security, clients, ...   Other pages (share the same CSS classes)

backend/edge-api/            (branch cloudflare-edge-api-phase1)
  wrangler.jsonc             Bindings, vars, cron
  src/index.ts               Entry point + routing + scheduled handler
  src/types.ts               Env type
  src/lib/register-route.ts  POST /auth/register
  src/lib/core-routes.ts     Profile, dashboard, opportunities, proposals, approvals
  src/lib/workflow-routes.ts Discovery, pipeline status, projects, tasks, invoices
  src/lib/discovery-agent.ts Runs all sources, filters, scores, auto-drafts
  src/lib/project-sources.ts Freelancer.com, Hacker News, Reddit, RemoteOK, Himalayas
  src/lib/apply-agent.ts     Gmail + Freelancer sending, reply reading, AI reply labels
  src/lib/apply-routes.ts    Send, applications, replies, Gmail connect routes
  src/lib/source-utils.ts    Shared fetch + HTML cleanup + lead type
  src/lib/scoring.ts         Deterministic 0-100 opportunity score
  src/lib/response.ts        {success, data, message} envelope helpers

backend/app, backend/alembic   Original Python app + migrations (reference spec for porting)
```

`backend/cloudflare` and `backend/queue-consumer` are legacy and can be deleted once the old Workers are gone.

---

## 4. Setup from scratch

### 4.1 Database (Neon)
1. Create a Neon project.
2. Open the **SQL Editor** and run the full schema file `neon_schema.sql` once (68 tables).
3. Check: `select count(*) from users;` should return `0`, not an error.

### 4.2 Hyperdrive
Create a Hyperdrive config pointing at the Neon connection string. Put its id in `backend/edge-api/wrangler.jsonc` under `hyperdrive[0].id`.

### 4.3 API Worker (branch `cloudflare-edge-api-phase1`)
Variables (`wrangler.jsonc` → `vars`):

| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `CORS_ORIGINS` | your frontend URL, e.g. `https://freelance-income-ai.<account>.workers.dev` |
| `PUBLIC_REGISTRATION` | `true` to allow sign-up, `false` to close it |
| `REQUIRE_EMAIL_VERIFICATION` | `false` (registration needs this) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` (max 30 days) |
| `INCLUDE_JOB_BOARDS` | optional, `false` = project sources only |
| `FREELANCER_TOKEN` | optional secret for the Freelancer.com API |

Bindings: `HYPERDRIVE`, `AI` (Workers AI), queue `FREELANCE_JOBS`, cron `0 */6 * * *`.

**Secret (important):** `JWT_SECRET` must be set under **Settings → Variables and Secrets** (runtime). A secret added only in the **Builds** section is NOT available at runtime.

### 4.4 Frontend Worker (branch `main`)
Set build variable `NEXT_PUBLIC_API_URL` to the edge API URL, e.g. `https://freelance-income-ai-api-edge.<account>.workers.dev`. It is a build-time variable, so **rebuild** after changing it.

### 4.5 Auto-apply and replies (one-time setup)
1. **Database:** run `apply_tables.sql` once in the Neon SQL Editor (3 new tables).
2. **Gmail (sends emails and reads replies, no domain needed):**
   1. Open https://console.cloud.google.com, create a project, and enable the **Gmail API**.
   2. APIs & Services → OAuth consent screen: User type **External**, add your Gmail as a **test user**.
   3. Credentials → Create credentials → **OAuth client ID** → type *Web application*. Under *Authorized redirect URIs* add exactly:
      `https://freelance-income-ai-api-edge.girishmore097.workers.dev/api/v1/integrations/gmail/callback`
   4. Copy the Client ID and Client Secret into the API Worker (**Settings → Variables and Secrets**, runtime) as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   5. In the app open the **Replies** tab and press **Connect Gmail**.
   Note: while the Google app is in *Testing* status, Google expires the connection after 7 days and you must press Connect Gmail again. Setting the consent screen to *In production* removes that limit (Google shows an "unverified app" warning that you can accept for your own account).
3. **Freelancer.com (optional, for automatic bids):** create an access token in your Freelancer.com developer settings and add it as the runtime secret `FREELANCER_TOKEN`.

### 4.6 First use
1. Open the frontend, create an account (password **12-128 characters**).
2. Fill the Profile tab (the sidebar shows a profile-strength meter).
3. Press **Find work now** on Home.
4. Review matches → approve proposals → apply → track.

---

## 5. API reference (`/api/v1`)

All responses use `{ success, data, message }`. All routes except auth need `Authorization: Bearer <token>`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login` |
| Profile | `GET /profile`, `PUT /profile` |
| Dashboard | `GET /dashboard` |
| Opportunities | `GET /opportunities`, `POST /opportunities`, `GET /opportunities/ranked`, `POST /opportunities/:id/status` |
| Proposals | `GET /proposals`, `POST /proposals/generate`, `PUT /proposals/:id`, `POST /proposals/:id/request-approval` |
| Approvals | `GET /approvals`, `POST /approvals/:id/decision` |
| Discovery | `GET /discovery/status`, `POST /discovery/run`, `POST /discovery/draft` |
| Projects | `GET/POST /projects`, `PATCH /projects/:id`, `PATCH /tasks/:id` |
| Invoices | `GET/POST /invoices`, `PATCH /invoices/:id` |
| Agents | `GET /agents/runs` |
| Send & replies | `POST /proposals/:id/send`, `GET /applications`, `POST /applications/sync`, `POST /applications/:id/reply` |
| Connections | `GET /integrations/status`, `GET /integrations/gmail/connect`, `GET /integrations/gmail/callback`, `POST /integrations/gmail/disconnect` |

Not-yet-ported features (workflows, research, emails, notifications, portfolio, etc.) return empty lists so the UI never errors.

---

## 6. Scoring (0-100)

| Part | Max |
|---|---|
| Skill fit | 35 |
| Budget fit | 20 |
| Client quality | 15 |
| Deadline feasibility | 10 |
| Competition level | 10 |
| Scope clarity | 10 |

Discovery stores a job only if at least 1 skill matches and the score is **45+** (max 25 new jobs per run). Jobs scoring **60+** get an auto-drafted proposal. Duplicates are skipped using `source:external_id` and a title+company fingerprint.

---

## 7. Development

```bash
cd backend/edge-api
npm install
npm run check      # tsc + vitest (26 tests)
npx wrangler dev

cd frontend
npm install
npx tsc --noEmit -p .
```

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Login says "Not Found" | Frontend points at the wrong Worker. Set `NEXT_PUBLIC_API_URL` to the edge API and rebuild. |
| 503 on register/login | Database has no tables (run `neon_schema.sql`) or `JWT_SECRET` is missing at runtime. |
| 422 on register/login | Password shorter than 12 characters. |
| Login succeeds but dashboard is blank | Old `page.tsx` deployed. The frontend builds from `main`, so commit it there. |
| 401 on every request | Session expired. The app now signs you out and asks you to log in again. |
| "Exceeded CPU" in logs | Free-plan CPU limit. Run discovery less often. |
| Gmail connect says failed | The redirect URI in Google Cloud must match the backend URL exactly, and your Gmail must be a test user. |
| Replies not showing | Press Check for replies now. Gmail connections in Testing status expire after 7 days. |
| Few or no matches | Add more skills to your profile; each run searches one skill term. |

Check **Cloudflare → Worker → Observability** for `core.route_failed`, `workflow.route_failed`, `proposal.ai_failed`.

---

## 9. Limits to know

- Cloudflare free plan: CPU time and 50 subrequests per request.
- Remotive: about 4 requests/day, attribution required. Jobicy: at most hourly.
- Workers AI drafts fall back to a template if the AI call fails.

---

## 10. Roadmap

- Telegram alerts when a client replies
- Client research and price suggestions
- Email follow-ups
- Porting remaining features from `backend/app`

---

## Credits

Lead data from [Freelancer.com](https://www.freelancer.com), [Hacker News](https://news.ycombinator.com), [Reddit r/forhire](https://www.reddit.com/r/forhire), [Remotive](https://remotive.com), [Jobicy](https://jobicy.com), [RemoteOK](https://remoteok.com) and [Himalayas](https://himalayas.app). Please keep the links back to the original listings.
