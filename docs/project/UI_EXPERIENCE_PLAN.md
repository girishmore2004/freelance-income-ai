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
| U2 | Public marketplace: browse projects and project detail without login (native only, clearly labelled), categories, browse freelancers and public profiles (opted-in only), About, Contact; legal pages as honest "awaiting legal review" | PLANNED |
| U3 | Freelancer dashboard answering the five questions; client dashboard; unified discovery (native + external, filters, saved, freshness) | PLANNED |
| U4 | AI Agent Centre: agent detail, ask/task with evidence, history, usage; command bar routing | PLANNED |
| U5 | Posting wizard; Proposal Studio sections and version history; contract workspace tabs | PLANNED |
| U6 | Analytics (freelancer, client, platform) from Edge data; admin user management and audit log viewer | PLANNED |

Out of scope until decisions: live payments and payouts (D-1/D-2), legal pages text (D-1), email delivery (D-15), services catalogue pricing (D-14), Python-only tools (D-11).
