# UI / Experience Plan — gap analysis against PRODUCT_EXPERIENCE_SPEC.md

Baseline: 2026-11-18, release 5.65.0 (all CI green). The spec (founder addendum to Master Plan v2) is in `PRODUCT_EXPERIENCE_SPEC.md`. This record lists what exists, what is missing, and the batch order. It reflects code, not intentions; each batch updates the status column after CI passes.

## Where the experience stands today

| Spec area | Exists today (verified in code) | Gap |
|---|---|---|
| §2 Public website | Sign-in card on `/`; `/how-it-works`, `/pricing` (live plans, fee status), `/safety`, `/help` | No marketing homepage, no public browse of projects/freelancers/categories, no About/Contact; Terms/Privacy/Refunds/Disputes need legal text (D-1) |
| §3 Freelancer workspace | Older single-page dashboard on `/` (discovery, drafts, approvals, apply, replies, projects, profile, portfolio); `/projects`, `/contracts`, `/earnings`, `/workspace`, `/agent`, `/coach`, `/notifications`, `/account` | No shared app shell: every page has its own header; no role-aware sidebar; no top bar (search, AI command, notifications, credits, profile menu) |
| §4 Discovery | External discovery with scores and reasons (home); native projects with match explanations (`/projects`) | One combined discovery view with filters/sort, native vs external labels, saved opportunities, freshness |
| §5 Proposal Studio | AI drafts for external opportunities (home), native proposal form | Sectioned editor, portfolio evidence, unsupported-claim check, version history UI |
| §6 AI Agent Centre | `/ai-agents` registry with status and switches, agent activity, coach, action plan | Agent detail pages (ask/task, evidence, history, usage), persistent command bar |
| §7 Client workspace | `/client/projects` (post, match, invite, proposals, comparison, offers), `/contracts`, `/account` teams | Client dashboard and client-specific navigation |
| §8 Posting wizard | One-page brief form with AI Brief Builder | Ten-step wizard (references/files step depends on R2) |
| §9 Freelancer discovery / comparison | Matches with reasons, saved freelancers, C3 comparison | Public freelancer profiles and browse; discussions/interviews |
| §10 Inbox | Contract messages, notifications inbox, Gmail replies (home) | Unified inbox across contracts and email, search |
| §11 Delivery workspace | Milestones, deliveries, files (R2), revisions, messages, activity, payments, disputes, reviews | Tabs layout, tasks/timeline/handover, category-specific stages, hourly/retainer models |
| §12 Finance | Test-mode funding, releases, refunds, payouts, test invoices, earnings page, staff ledger/trial balance | Client spend view, monthly reports, charts; live money BLOCKED (D-1/D-2) |
| §13 Analytics | Workspace overview, admin overview counts | Freelancer/client/platform analytics pages (legacy page is Python-only, K-01) |
| §14 Admin | Overview, moderation, reports, disputes, suspensions, flags, finance, agents | User management, verification, source management, audit-log viewer, system health |
| §15 Design system | Dark theme tokens in `globals.css` | Light-first tokens, consistent components |
| §16 Mobile | Responsive grid and collapsible sidebar on home only | Shell-level mobile navigation everywhere |
| §18 Governance | A0–A3 ceilings in the registry, human gates, governor, audit logs | — (kept; extend to new agent UIs) |

## Batch order (each batch: code + tests + CI green before the next)

| Batch | Scope | Status |
|---|---|---|
| U1 | Light-first design tokens; one app shell for signed-in pages (role-aware sidebar: freelancer / client / staff, top bar with search, AI command, notifications, AI usage, profile menu, mobile drawer); public marketing homepage on `/` for visitors (sign-in kept on the page) | DONE (code, 5.66.0) — the older single-page dashboard on `/` keeps its own navigation until U3 |
| U2 | Public marketplace: browse projects without login (native, labelled), browse freelancers and public profiles (opted-in only, real reviews), featured projects and freelancers on the homepage; **one Find work page** with native and external opportunities together (filter All / Native / External, source labels, freshness, original-post links), the separate Matches area removed from the dashboard (`/` = proposals and applications) | DONE (code, 5.67.0); About/Contact and legal pages pending (legal text D-1) |
| U3 | Dashboard answering the five questions (apply next, next actions, deadlines, money waiting/earned, recommendations) for freelancers and client managers; unified discovery shipped in U2 | DONE (code, 5.68.0); saved opportunities and calendar pending |
| U4 | AI Agent Centre: overview (agents available, my runs, failures, AI calls today, drafts waiting), per-agent usage, tools, history and an "Open" link to where each built agent works; command bar routing (U1) | DONE (code, 5.69.0); free-form tasks per agent pending (each agent acts inside its page) |
| U5 | Posting wizard; Proposal Studio sections and version history; contract workspace tabs | DONE (code, 5.71.0); reference files on listings pending (files live in the contract workspace) |
| U8 | External application record (analysis, versions, approval, submission, follow-ups, interviews, outcome); finance exceptions; failed jobs | DONE (code, 5.74.0) |
| U16 | Ask about an agent from its card | DONE (code, 5.82.0) |
| U12 | Saved searches and alerts, profile checklist, invitation fix | DONE (code, 5.78.0) |
| U13 | Take-home and all-in cost while pricing; monthly statements and CSV | DONE (code, 5.79.0) |
| U14 | Publish-to-shortlist, weekly progress, Hire again, suspended clients paused | DONE (code, 5.80.0) |
| U15 | Daily external-jobs digest; dedicated MFA key | DONE (code, 5.81.0) |
| U10 | Project reference files; freelancer and client verification queues; external source management and freshness | DONE (code, 5.76.0) |
| U11 | Contract workspace Tasks, Timeline and Handover tabs | DONE (code, 5.77.0); hourly/retainer billing pending |
| U9 | Proposal discussions, interview scheduling, unified inbox, interviews on the calendar | DONE (code, 5.75.0) |
| U7 | Saved projects, calendar, About and Contact, support tickets in admin | DONE (code, 5.73.0) |
| U6 | Analytics (freelancer, client, platform) from Edge data; admin user management and audit log viewer | DONE (code, 5.72.0); system health added; verification queues, source management and support tickets pending |

Out of scope until decisions: live payments and payouts (D-1/D-2), legal pages text (D-1), email delivery (D-15), services catalogue pricing (D-14), Python-only tools (D-11).
