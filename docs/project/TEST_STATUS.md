# Test Status

## U30 — genuine external sources (2026-11-20, release 5.97.0)
- Edge: vitest **458 passed** (new `genuine.test.ts` 5: ordinary ads with an email or rate pass; fees first, chat apps, crypto, UPI, get-rich, $900/h, empty, link shorteners, http/javascript links and look-alike hosts rejected; `project-sources.test.ts`: "Who is hiring?" keeps only remote contract/freelance company posts, Reddit makes no request without an agreement — changed on purpose (Reddit policy) and its old test now passes the agreement; the HN fake answers by URL because two threads are read in parallel). Typecheck and bundle clean. Live source calls cannot run here (network blocked); CI and the first cron run are the real check.
- Frontend: typecheck clean, unit 49 passed; the search result says how many listings were hidden as possible scams.
- GitHub CI: Edge API CI success @ cc1d7d1; `main` @ bad053a and 6dbacd6 Backend tests and Full CI success (pytest, Alembic, build, Playwright in both modes).

## U29 — deadlines when someone stops answering (GitHub CI verified, 2026-11-20, release 5.96.0)
- Edge: vitest **451 passed** (new `deadlines.test.ts` 9: review deadline with extensions, lateness, late-cancel after 24 h, 48-hour cancellation, dispute reply window, and the three jobs; `disputes.test.ts` changed on purpose: its dispute is 8 days old because staff now wait for the reply window, plus a test of the window). Edge API CI success @ 0cc2b26.
- PostgreSQL through the real Worker (`scripts/e2e-catalogue.ts`, **267/267**): 21 new cases. A service delivery shows "completes in 3 days", the client extends twice and a third time is refused; the 6-hourly job run with a clock 14 days ahead approved it, completed the order and released exactly ₹7,760 (₹8,000 − 3%); a waiting fixed-price delivery stayed untouched (D-25); a second run changed nothing. A milestone due today is not late; 3 days past due it is Late and the client cancelled alone with the full ₹5,250 refunded. A cancellation request stayed open before 48 hours and was accepted with a refund after. Staff were refused (WAITING_FOR_REPLY) until the other side answered. Lockout message after 5 wrong passwords; a wrong password during the lock still gets the usual answer; a one-letter name refused; the automatic client account is named after the person. Ledger balanced.
- Frontend: typecheck clean, unit 49 passed; new `e2e/deadlines.spec.ts` (3 journeys).
- GitHub CI: `main` @ 6d0720a pytest **599 passed** (Alembic upgrade to 0080 on PostgreSQL); Playwright **102 passed** (bearer), **103 passed** (cookie).

## U28 — end-to-end test-case catalogue (2026-11-20, Edge 5.95.0)
- 245 server cases through the real Edge Worker on PostgreSQL with fresh accounts (`backend/edge-api/scripts/e2e-catalogue.ts`): visitor and sign-up 24, freelancer 63, client 74, portals 11, trust and safety 36, staff/money/AI 23, security 14. **245/245 pass** after two fixes. Report: claude.ai Docs "Freelance Income AI — End-to-End Test Cases and Results".
- Defects found and fixed: (1) off-platform payment screening missed UPI, Paytm, UPI IDs, NEFT and "without the platform fee" (12 phrasings now caught, 13 ordinary sentences pass; unit tests); (2) a client could report a project of their own client account (now 422; unit test).
- First-run failures that were test mistakes (short notes, wrong field names): 12; local database gaps (tables from migration 0045, present in production): 2. Ten weak cases were rewritten to test what their titles say.
- Edge vitest **441 passed**; Edge API CI success @ dc42ce1. Frontend unchanged (5.94.0 CI: Playwright 99/100 passed, unit 49).

## U27 — Client profile, Security fixed, sides from the switch (GitHub CI verified, 2026-11-19, release 5.94.0)
- Edge: vitest **439 passed** (new: automatic client account named after the person or email, created once, not for freelancer-only accounts or while hiring is closed). Edge API CI success @ afeb428.
- PostgreSQL through the real Worker: a new "Hire" account → three identity requests at the same moment all returned 200 and saw the same single individual client account (owner, IN); 1 membership in the database; editing it to a company with billing details 200; a freelancer-only account had none until hiring was turned on, then one. Security: sessions 200 (list), two-factor status 200 (the local test database first lacked `mfa_recovery_codes` from migration 0045; production has it).
- Security page defect found and fixed: it read the API reply as a bare list, so the page crashed ("This page couldn't load"); there was no browser test for it. Now on the shared API client with a new e2e.
- Frontend: typecheck clean; unit 49 passed. New `e2e/client-profile.spec.ts` (client profile edit with a field error, Projects without a setup step; Security with sessions and two-factor status). Changed on purpose: `account.spec.ts` (no roles section; hiring added from the top switch, closed → message) and the owner test in `mode.spec.ts` (Freelancer added from the switch).
- GitHub CI: `main` @ fcccdb4 pytest **596 passed**; Playwright **99 passed** (bearer), **100 passed** (cookie).

## U26 — one portal at a time (GitHub CI verified, 2026-11-19, release 5.93.0)
- Edge: vitest **436 passed** (new: top items per side so one side cannot crowd out the other; the action-plan fixture carries a side). Typecheck clean; bundle builds. Edge API CI success @ 4659c54.
- PostgreSQL: action plans for 19 local accounts carried a side on every action (13 actions: invitations, drafts and disputes as freelancer; deliveries, proposals and disputes as client); an open dispute appeared as Freelancer for one party and Client for the other. Sign-up through the real Worker: Find work → [freelancer], Hire → [client], Both → [client, freelancer], no choice → [freelancer], unknown choice 422.
- Frontend: typecheck clean (app + e2e); unit **49 passed** across all 18 files (new: items follow their side, Ask AI per portal, one sidebar link lit). CI previously ran only 5 of the 18 unit-test files; it now runs all of them.
- e2e: new Client-portal journey (dashboard, next actions, analytics without Planning tools, AI agents without freelancer drafts, account with client accounts and client-side blocks; the same pages on the Freelancer side) and a sign-up choices journey (Freelancer only, Client only, both). Changed on purpose: the U22 owner test now expects only Client and Admin until Freelancer is turned on from Account (D-24); the team test opens Account on the Client side; the experience test expects "earnings" on the Client side to open the client's spend.
- GitHub CI: `main` @ eef41a3 pytest **596 passed**; Playwright **97 passed** (bearer), **98 passed** (cookie). On the way, CI caught one real defect of mine (a page saving its side gave the account that role, so a freelancer-only account lost the "Turn on hiring" offer; fixed) and two test mistakes of mine (the Client side re-seeded on every load; a name that also appeared in a button).

## U25 — portals, notifications and speed (GitHub CI verified, 2026-11-19)
- Frontend: typecheck clean (app + e2e), unit **46 passed** (new: the Admin workspace keeps staff on Notifications, Account, Security and Contact, and never leaks into the Freelancer or Client side).
- New e2e in `mode.spec.ts`: from `/admin` the bell (1 unread = staff and account notices only) opens Notifications with Admin still pressed, the admin menu, only the staff notice listed, "Back" to `/admin`, no full page reload and at most 2 account requests; choosing Client afterwards makes account pages follow Client again.
- Real components in Chromium (esbuild bundle of the shell with a mocked API) at 390, 820 and 1366 px for Freelancer, Client and Admin: right side colour on each, **no sideways scrolling**, search and Ask AI present in the phone menu. Before the fix the Admin phone view was 50 px wider than the screen.
- GitHub CI: `main` @ 88cb60f pytest **596 passed**; Playwright **95 passed** (bearer), **96 passed** (cookie). The first run (b437974) failed one older test because the phone menu copy reused the label "AI command"; the menu copies now have their own labels (no test changed).

## U24 — the 11 partly built agents completed (GitHub CI verified, 2026-11-19)
- Edge: vitest **435 passed** (new `agent-evals.test.ts` runs all 54 evaluation cases across 21 agents; new `agent-complete.test.ts` 8: staff-only routes, settings validation, trust signals never throw, stale-job query, ISO weeks). Typecheck clean; bundle builds. Two of my own mistakes were caught by the new evaluations and a test fake and fixed: the link checker returns an empty string (not null) for a bad link; a settings query text collided with the notification test's fake.
- PostgreSQL through the real Worker with fresh accounts (0079 DDL): F3 flagged "World-class expert" without completed work (score 56), a skill no project shows and a project without a link; P1 recorded 3 contact and 1 payment attempt and listed the client as a medium finding (non-staff 404); F9 labelled "Please add a pickup time picker" as a change request with a reply starter; F7 reported 25 booked of 20 hours (over) and C2 matching gave the booked freelancer 0 availability points with "Fully booked at the moment"; C7 forecast ₹10,000 + ₹500 fee in Nov and ₹20,000 + ₹1,000 in Dec, hourly up to ₹30,000 + ₹1,500 a week, another account 404; F11 answered without the model by citing the matching contract first; P9 muting "proposals" held back an invitation notification and the next one after unmuting arrived, muting the account group 422; F1 hid a 30-day-old job unseen for 10 days and kept one seen yesterday; P5 recorded Remotive's terms (non-admin 403, javascript link 422) and a takedown hid the saved copy, repeat 409; P7 alerted 2 projects without proposals after 3 days and sent one weekly digest per admin (second run deduplicated); P8 health: self-tests 12/12, evaluations 54/54, no agent failing.
- Frontend: typecheck clean (app + e2e), unit 45 passed. New `e2e/agents-complete.spec.ts` (3 journeys: freelancer, client, admin).
- GitHub CI: `main` @ a20b7e8 pytest **596 passed** (Alembic upgrade to 0079 on PostgreSQL); Playwright **94 passed** (bearer), **95 passed** (cookie). Edge @ 408f515: Edge API CI success. The new freelancer journey first failed twice: (1) it exposed a real defect, fixed: `/profile` crashed when the Projects-for-you reply had an unexpected shape (now ignored safely); (2) a test selector matched "Always on" inside a longer label (made exact).

## Full user-journey verification (2026-11-19, release 5.90.0)
- One end-to-end run through the real Edge Worker (router, sign-up and sign-in, sessions, handlers) on PostgreSQL with brand-new accounts: **149 of 149 steps as expected** across visitor (8), freelancer (50, two accounts), client owner (43), client team member (9), moderator (8), finance (6), admin (10) and system checks (15, sign-ups and ledger).
- Covered: public pages; sign-up for each side; staff roles as the workflow grants them (admin keeps the freelancer side); fee schedule drafted by finance, approved by admin (5% + 3%); profile, resume reading, portfolio; client account and team invitation; Brief Builder, publish with screening, matches, invitation; price advice, proposal draft, check, proposal; messages and interview; comparison, interview questions, suggested milestones, offer, acceptance; funded milestones in test mode, delivery check, delivery, acceptance checklist, revision, approval and release; two-way reviews; earnings, payout, statements; a service sold and ordered; an hourly contract with a week logged, approved and paid; block refused during an open contract; proposal cap; report dismissed by a moderator; dispute with evidence pack, moderator refused a money outcome, admin decided; trial balance, payments, exceptions, analytics, health, user search, agent self-tests 12/12; dashboards, action plans, calendars and per-side notification counts.
- Money: ₹15,000 milestone → client paid ₹15,750; ₹30,000 contract → freelancer ₹29,100; 2.5 h at ₹1,200 → ₹3,150 incl. fee; whole ledger balanced.
- Refusals confirmed: visitor contracts 401, non-staff admin 404, member publish/fund 403, delivery before funding 409, finance approving fees 403, moderator money outcome 403, live payments 409, block during an open contract 409.
- Local test-database gap only: the hand-built `users` table lacked the password columns (production uses the full migration chain); added locally before the run. No AI provider attached: model-based agents used their fallbacks.
- Report with diagrams: claude.ai Docs "Freelance Income AI — How the Platform Works".

## U23 — audit, fair proposals and blocking (GitHub CI verified, 2026-11-19)
- Audit: 355 API calls found in the frontend were replayed through the real Edge router on PostgreSQL. Every call from the live pages is served; the unserved ones are only the 8 older Python tool pages behind the "not available" notice (K-01) and scanner artefacts (re-checked with real values). One dead link (`/proposals` on an older tool page) fixed. No placeholder buttons. Side mixing found and fixed on Services (both buy and sell toggles on one page) and Spend (the client page showed the freelancer balance and payouts).
- Edge: vitest **425 passed** (new `fair.test.ts` 10: weekly limit, near-copy similarity, intake validation, proposal ranges, block routes). Typecheck clean; bundle builds.
- PostgreSQL (real handlers, 0078 DDL): 10 proposals sent, the 11th refused (429 with the explanation); a near-copy flagged at 80% before sending; client cap of 1 → second proposal closed the project, public card "not taking proposals", 409 for the next freelancer; cap below received 422; reopen and close by hand; block with a phone number in the reason 422; client block declined both open proposals, duplicate 409, the blocked freelancer saw none of the client's 12 projects (another freelancer saw 12), proposal 404, invitation 403 `NOT_AVAILABLE`, block list for the client only; the freelancer could not lift it (404); unblock restored the 12 projects; a freelancer's block withdrew their 10 proposals and the client could not lift it; a block with an open contract 409. **Defect found and fixed:** a removed team member was still treated as a member (could never propose to that client).
- Frontend: typecheck clean (app + e2e), unit **45 passed**. New `e2e/fair.spec.ts` (2 journeys).
- GitHub CI: `main` @ c28a831 pytest **592 passed** (Alembic upgrade to 0078 on PostgreSQL); Playwright **91 passed** (bearer), **92 passed** (cookie). Edge @ edd2c29: Edge API CI success. The first two runs failed only in the new client journey on test selectors ("Taking proposals" and "Ravi K" also appear inside button names); fixed with exact matches, no product change.

## U22 — side separation fix (GitHub CI verified, 2026-11-18)
- Edge: vitest **415 passed** (identity: a staff-only or admin + client account keeps or regains the freelancer side; a switched-off freelancer row stays off). Typecheck clean; bundle builds.
- PostgreSQL (real functions): owner-like account (admin + client rows) → roles admin, client → Freelancer switch → admin, client, freelancer; moderator-only account → roles freelancer, moderator, and `/me` wrote the freelancer row once (second call wrote nothing).
- Frontend: typecheck clean (app + e2e); unit **45 passed** (`mode.test.mts`: older freelancer tools belong to the freelancer side, calendar and analytics shared). New Playwright journeys in `e2e/mode.spec.ts`: the owner's admin + client account sees Freelancer, turns it on in one click, the calendar from the freelancer sidebar shows only freelancer dates; a freelancer-only account on a client page sees the client menu and a "Turn on" offer, never the freelancer menu.
- GitHub CI: `main` @ 9729ba4 pytest **589 passed**; Playwright **89 passed** (bearer), **90 passed** (cookie), including both new journeys. Edge @ 34dc9ed: Edge API CI success.

## U20 + U21 — GitHub CI (verified, 2026-11-18)
`main` @ 68cfb66: pytest **589 passed** (Alembic upgrade to 0077 on PostgreSQL in CI); Playwright **87 passed** (bearer), **88 passed** (cookie). Edge @ ccbb5fc: Edge API CI success, vitest **414 passed** (new `agent-tools.test.ts`; `notify.test.ts` adds notification sides). The previous push (d86bd06) failed one test, `e2e/agents.spec.ts`: platform agents moved to the Admin view on purpose (one side at a time, decision of 2026-11-18), so the test now checks that the freelancer view hides P2 and the admin view shows it with "Switch off".
- Agent self-tests (`GET /admin/agents/health`): **12/12 passed** — C2 matching, C3 comparison, C5 milestone split, C6 acceptance checklist, F8 delivery precheck, F3 resume reading, F5 price advice, C4 interview questions, F2 scoring, C1 brief guard, P1 screening, P8 payment guard set. Model-backed agents depend on the Workers AI binding; the live test is on the admin page.
- PostgreSQL (real handlers): price advice for a listing (range from hourly rate × hours, budget fit), delivery precheck (criteria covered or missing, no state change), interview questions (outsider 404), health check as admin (non-staff 404); notifications and inbox threads carry the side (freelancer/client) and the unread count splits by side; auto-approval of timesheets approved one overdue week, then 0 on the re-run.

## U19 — GitHub CI (verified, 2026-11-18)
Green on the first push. `main` @ d39df45: pytest **587 passed**; Playwright **85 passed** (bearer), **86 passed** (cookie). Edge @ ce68094: Edge API CI and Full CI success; vitest **408 passed** locally (new `timesheets.test.ts` 7). Frontend unit 43 passed. The planner e2e was changed on purpose: the calendar now opens on the active side (decision of 2026-11-18), with Everything one click away.
- PostgreSQL (real handlers): hourly offer (₹800/h, 3 h a week; total ₹2,400) → time refused before activation → accepted → client logging 403 → 2 h + 45 min logged → over the limit 409 (15 min left) → entry removed → 50 min logged (170 min, ₹2,266.67) → client submit 403 → submitted → late entry 409 → pay before approval 409 → return without note 422 → returned → resubmitted → approved → checkout ₹2,346 (fee 3.5% client, 2.5% freelancer) → same key returned the same checkout → test payment completed and released at once → week paid → second payment 409 → statement line (milestone null) → change order switching to fixed price 422 → client ended the contract → second end 409 → logging after end 409 → outsider 404. Ledger for the contract: funds and fees held 0, freelancer payable ₹2,210, fee revenue ₹136 = clearing ₹2,346; whole trial balance 0. Notifications for submitted, returned, approved, paid and ended.

## U18 — GitHub CI (verified, 2026-11-18)
Green on the first push. `main` @ f9eeeb8: pytest **584 passed** (Alembic upgrade to 0075 on PostgreSQL in CI); Playwright **82 passed** (bearer), **83 passed** (cookie). Edge @ bac445d: Edge API CI and Full CI success; vitest **401 passed** locally (new `services.test.ts` 6). Frontend unit 39 passed.
- PostgreSQL (real handlers): service without freelancer role 403, short title 422, draft hidden from visitors, publish → live, payment wording → held for review, browse shows only live services with the seller card, non-staff queue 404, return without note 422, returned (notification); orders: no client role 403, outsider 404, member 403, unknown package 422, missing requirements 422, phone number 422, order → offered contract (title "… (Standard)", ₹3,000, due in 5 days, client accepted) → freelancer accepted → active; tasks used the service category's 3 stages; second order declined; paused service 404 on order; report of own service 422, report actioned and service hidden pending review; categories: non-staff 404, moderator read-only (403 to switch), close without reason 422, close and reopen logged; public profile lists services for sale; client analytics ran with service contracts.

## U17 — GitHub CI (verified, 2026-11-18)
`main` @ e029685: pytest **581 passed**; Playwright **80 passed** (bearer), **81 passed** (cookie) — the first e2e attempt hung installing Chromium on the runner and was cancelled and re-run unchanged. Edge @ d048715: Edge API CI and Full CI success; vitest **395 passed** locally (new `profile.test.ts` 9). Frontend unit `profile-import.test.mts` 4.
- PostgreSQL (real handlers): projects read before/after save, invalid title 422, saved list round-trips; Projects for you scored native projects (100 and 75 with reasons and missing skills; own and already-proposed projects excluded) and external opportunities for a second freelancer; pasted resume read by rules (4 skills, 1 link) with an `agent_runs` row `profile_coach` and nothing saved. Word reading checked with a deflated ZIP and a real python-docx file.

## U12–U15 — GitHub CI (verified, 2026-11-18)
Every batch green on its first push. Latest: `main` @ 0f1f159 pytest **579 passed**; Playwright **77 passed** (bearer), **78 passed** (cookie). Edge @ 9e9b4c2: Edge API CI success, vitest **385 passed**.
- PostgreSQL runs: saved search alert sent only to the matching freelancer when a moderator approved a held project (organisation member and budget-mismatched search excluded), new counts and seen, alerts toggle, delete, other user's search 404; checklist 60% for a partial profile, not applicable for clients; invitations report the proposal already sent. Statements reconciled (₹50,000 released − ₹1,250 fees = ₹48,750 withdrawn), client member 403, outsider 404, future month 422, CSV download. Progress lines for an active contract, outsider 404; Monday digest sent once per week (re-run sent no duplicates), nothing on Wednesday; hidden past collaborator invited, stranger 404; suspension paused the owner's 3 published projects and logged it. Daily jobs digest sent once per UTC day, not at 12:00 UTC. MFA key ring unit-tested with real Fernet tokens (legacy read, re-encrypted read, wrong key refused).

## U11 — GitHub CI (verified, 2026-11-18)
Green on the first push. `main` @ bd4522f: pytest **577 passed**; Playwright **71 passed** (bearer), **72 passed** (cookie). Edge @ 8939618: Edge API CI and Full CI success, vitest **376 passed**. Frontend unit 33 passed.
- PostgreSQL end-to-end: member plan 403, outsider 404, plan of 10 tasks from the website category (Design approval, Staging review and Launch approval to the client, spread over 2 milestones), plan again 409, client task added, invalid milestone 422, task done, member edit 403, delete, completed contract add 409; handover with a password 422, client adding 403, freelancer item, member confirm 403, client confirm, withdraw after confirm 409; events tasks.planned / handover.added / handover.confirmed with notifications to the other side; calendar showed each side only its own due tasks.

## U10 — GitHub CI (verified, 2026-11-18)
Green on the first push. `main` @ a923188: pytest **575 passed**; Playwright **69 passed** (bearer), **70 passed** (cookie). Edge @ f004417: Edge API CI and Full CI success, vitest **372 passed**.
- PostgreSQL end-to-end (in-memory R2): member upload 403, disguised PNG 422, owner upload, member and freelancer listing, freelancer download as attachment, draft project hidden (404), freelancer delete 403, owner delete removed the object, closed project 409; verification: bad evidence 422, request, duplicate 409, member client request 403, owner request, non-staff queue 404, queue with platform facts, reject without note 422, approve, approve twice 409, `client_verified` on the project, `verified` on the public directory card, revoke without note 422, revoke cleared `verified_at`; moderation log and notifications written; sources: moderator switch 403, off without reason 422, off, unknown 404, discovery's disabled set, health computed from runs.

## U9 — GitHub CI (verified, 2026-11-18)
`main` @ 6f8b8eb: pytest **573 passed**; Playwright **66 passed** (bearer), **67 passed** (cookie). Edge @ 3b2ccdd/4614baa: Edge API CI success, vitest **363 passed** (34 files); Full CI success.
- Two CI problems on the way, neither a product defect: (1) GitHub moved `ubuntu-latest` to 26.04, where Playwright has no Chromium build, so the e2e job could not start on either branch — pinned to `ubuntu-24.04`; (2) the new inbox spec's `getByRole('alert')` also matched the empty Next.js route announcer — scoped to the discussion region.

## U8 — GitHub CI (verified, 2026-11-18)
Green on the first push. `main` @ ec8d2ca: pytest **571 passed**; Playwright **64 passed** (bearer), **65 passed** (cookie). Edge @ b2b7774: Edge API CI and Full CI success, vitest **355 passed** (+12 `pipeline.test.ts`; existing governor/brief/coach tests updated only where the governor now reads the full registry row and the caller's role).
- PostgreSQL end-to-end through the real core and workflow handlers (real session tokens): new → applied refused (409), → ready refused (system status); template draft with job-specific questions; edit → version 2; approval → ready; applied recorded with channel and reference; follow-up in 3 days; → interview; → drafted refused; timeline showed versions 2:edited, 1:safe_template, the submission, and events new>drafted, drafted>ready, ready>applied, submission, follow-up, applied>interview; other user 404; follow-up listed and on the calendar, marked done; won. Finance exceptions: none, reconciliation OK, both trial balances balanced; finance user refused job list (404); admin saw the dead job; retry without a queue → 503 logged (defect found and fixed: it crashed before); retry releases logged.

## U7 — GitHub CI (verified, 2026-11-18)
`main` @ 6e5b76c: pytest **569 passed**; Playwright **63 passed** (bearer), **64 passed** (cookie). Edge @ 1fe293e: Edge API CI and Full CI success, **343 passed** locally (+11 `planner.test.ts`). The first push (3dfb8c4) failed one new Playwright test: the "Resolve" action and the "Resolved" status toggle had overlapping names; the toggles were renamed "Open tickets"/"Resolved tickets" and the test uses the exact name.
- PostgreSQL run: save, update note, unknown project 404, saved list with open state, unsave; client calendar (2 milestones and a project deadline in 92 days); visitor ticket without email 422, with email 201 (stored lower-case); signed-in ticket linked; non-staff queue 404; moderator resolved (notification to the sender), second resolve 409; admin resolved a visitor ticket; 2 entries in the moderation log.

## U5 + U6 — GitHub CI (verified, 2026-11-18)
`main` @ 06265c8: pytest **567 passed**; Playwright **59 passed** (bearer), **60 passed** (cookie). Edge @ d06f1f5: Edge API CI and Full CI success, vitest **332 passed** (31 files). Frontend unit (node --test): **26 passed**.
- First U5 push failed 2 Playwright tests (proposal label changed case); fixed in 06265c8, not by editing the tests.
- Real PostgreSQL runs (local): Proposal Studio (draft, check, invalid evidence 422, approval mismatch 409, submit v1, revision request, edit → v2 with request cleared, identical save → no new version, history, outsider 404, comparison with sections, notifications) and every analytics/staff endpoint with role checks.

## U4 + security — GitHub CI (verified)
`main` @ 5692a95 and e70714d: pytest 565 passed; Playwright 56 passed (bearer), 57 passed (cookie). Edge @ f0f51e1 and 0906cc4: Edge API CI and Full CI success (300/300).

## Security sweep — 2026-11-18 IST (release 5.70.0)
- Scans: no raw/unsafe SQL, no `eval`/`new Function`, no `innerHTML`, no committed secrets, every `target="_blank"` has `rel`; every Edge route the frontend calls answers 401 without a session (except the intended public reads).
- **Found and fixed:** stored XSS through `javascript:` job links (K-33). Edge API **300 passed, 0 failed** (+1 link-safety test); frontend unit **14/14** (+`safe-url.test.mts`).

## U3 — GitHub CI (verified)
`main` @ a1a74e1: Playwright 56 passed (bearer), 57 passed (cookie); Edge @ 70b2b70: Edge API CI success (298/298).

## U4 agent centre — 2026-11-18 IST (release 5.69.0)
- Edge API: **299 passed, 0 failed** (`agents.test.ts` +1: my runs and AI calls grouped by agent, unknown runs ignored, missing approvals table tolerated).
- Frontend: typecheck 0 errors; `e2e/agents.spec.ts` extends the catalogue journey with the overview, per-agent usage and the "Open" link to where the agent works.

## Full lifecycle + U3 dashboard — 2026-11-18 IST (release 5.68.0)
- **End-to-end lifecycle on PostgreSQL, real handlers, one run, 24/24 steps as expected:** client posts and publishes → matching (freelancer scored 82) → invitation → proposal → shortlist → offer (2 milestones, 1 revision) → freelancer accepts → both milestones funded in test mode → file uploaded → delivery with the file → revision requested → redelivery → approved → second milestone delivered and approved → contract completed, both payments released → two-way reviews → freelancer withdraws the available balance → client action plan has nothing left for the contract; 17 notifications for the contract; trial balance equal and nothing left held for the contract.
- Edge API: **298 passed, 0 failed** (`business.test.ts` +1: deadlines within two weeks or overdue, approved milestones excluded, bad data ignored). Overview on PostgreSQL returns the new sections for freelancer and client.
- Frontend: typecheck 0 errors; `/workspace` answers the five dashboard questions (apply next, what to do, deadlines, money waiting and earned, recommendations); `e2e/business.spec.ts` covers the new sections.

## Audit + U2 — GitHub CI (verified)
`main` @ 93e7d86: pytest 565 passed; Playwright 56 passed (bearer), 57 passed (cookie). Edge @ d978ad8: Edge API CI success (297/297).

## Audit + U2 — 2026-11-18 IST (release 5.67.0)
- **Route audit:** every API call in the frontend (304 method/path pairs) was replayed through the real Edge router. All calls from current pages are served; the unserved ones were 6 unreachable dashboard tabs (inbox, workflows, delivery, research, portfolio, sources — Python-only routes). Those tabs were removed and the dashboard loader went from 24 requests per visit (13 failing) to 11.
- Edge API: **297 passed, 0 failed** (`listings.test.ts` +1: visitors may browse public projects and categories, invite-only projects stay hidden, everything else 401; `public.test.ts` +2: freelancer directory without private fields, closed while the marketplace is off, profile with revealed reviews, hidden freelancers 404). PostgreSQL: a visitor saw the 1 public published project, the categories and the 2 opted-in freelancers; the non-visible freelancer 404; organisation routes 401.
- Frontend: typecheck 0 errors; unit 13/13; `e2e/experience.spec.ts` now 4 journeys (+ unified Find work with labelled native/external items and drafting; visitor freelancer directory and profile). `critical-journeys` login check now looks for the dashboard's workflow navigation (the old sidebar tagline was removed with the sidebar).

## U1 — GitHub CI (verified)
`main` @ 1b0ac64: pytest 565 passed; Playwright 54 passed (bearer), 55 passed (cookie). Edge @ 9adf15d: Edge API CI and Full CI success (294/294).

## U1 experience: design system, workspace shell, public homepage — 2026-11-18 IST (release 5.66.0)
- Edge API: **294 passed, 0 failed** (`public.test.ts` +2: `/public/home` returns real categories closed while the marketplace is off, live agents and counts, read-only; degrades to empty data before migrations). Against PostgreSQL: 1 open category, 10 live or partly built agents, real counts.
- Frontend: typecheck 0 errors; unit tests **13/13** (new `command-route.test.mts`: command words route to pages, questions go to the coach pre-filled). New `e2e/experience.spec.ts` (2 journeys: homepage with real data and only non-zero counts; shell with role-aware navigation, mode switch, AI usage, notifications, profile menu and command routing). Existing specs checked for selector collisions with the shell (desktop viewport; no shared label or role names).

## Legacy pages — GitHub CI (fix verified)
`main` @ 4a3483c: pytest 565 passed; Playwright 52 passed (bearer), 53 passed (cookie). Edge @ fcc6dc6: Edge API CI and Full CI success (292/292).

## Legacy pages — GitHub CI
`main` @ cc9d422: pytest 565 passed; **frontend production build failed** (so Playwright could not start): in `app/clients/page.tsx` the gate import was inserted above `'use client'` (that file began with a blank line). TypeScript accepts this; Next.js does not. Fixed, and a new unit test `lib/client-directive.test.mts` checks every file under `app/` — it fails on the broken file and passes on the fix (frontend unit tests now 12/12). Re-verified with the next push.

## Legacy pages: workspace, action plan, coach on Edge — 2026-11-18 IST (release 5.65.0)
- Edge API: **292 passed, 0 failed** (new `business.test.ts` 10: goal validation as in Python; defaults, upsert per user and event log; plan ordering, every action needs a human; marketplace + legacy items with missing legacy tables tolerated; plan is read-only and limited; overview reports unavailable counts as null; citation validation; empty question 422 and no-evidence honest answer; model used only through the governor, untrusted question fenced, cited answer kept, usage recorded under `business_coach`; registry switch off → no model call, honest fallback. `agents.test.ts` map updated with `business_coach → F11`).
- **Defect found by the tests and fixed:** a follow-up reminder with an empty `due_at` would have crashed the overview (`Invalid time value`); dates are now checked.
- PostgreSQL 16 (minimal legacy tables): goals default → saved twice (merge) → read back; overview for a freelancer: 3 active contracts, 3 deliveries waiting for the client, ₹29,250 released this month **in test mode**, missing legacy tables shown as null; action plan: open dispute and a proposal draft; client plan: 4 deliveries to review (with project titles) and a new proposal; coach without a model listed the records instead of guessing; history and workspace events recorded.
- Frontend: typecheck 0 errors (`/workspace`, `/agent`, `/coach` rewritten on the shared API client; `LegacyGate` on 8 pages; `e2e/business.spec.ts` 3 journeys); unit tests 11/11.
- Python: `tests/test_business_coach_v566.py` compiled; runs in CI.

## Contract files — GitHub CI
`main` @ aaf136c (includes the team-spec label fix): pytest 564 passed; Playwright 49 passed (bearer), 50 passed (cookie) — the team journey now passes. Edge @ 42a33a6: Edge API CI **failed** at Typecheck — `new TextDecoder("utf-8", { fatal: true })`: the current `@cloudflare/workers-types` (installed fresh in CI; no lockfile, K-11) requires `ignoreBOM` too, while the local copy accepted it. Fixed in f6377eb (Edge API CI and Full CI green). Full CI on the same commit had passed.

## Team invitations — GitHub CI
`main` @ 3cb4e3d: pytest 562 passed; Playwright **1 failed**, 47 passed (bearer): `e2e/team.spec.ts` used `getByLabel('Role')`, which matched two fields on `/account` (strict-mode violation). Both fields were labelled "Role" — also an accessibility problem — so the invitation field is now "Role for the invited person" and the test uses that label. Edge @ 5238d8f: Edge API CI and Full CI success (275/275). Re-verified with the next push (below).

## Contract files (R2) — 2026-11-18 IST (release 5.64.0)
- Edge API: **282 passed, 0 failed** (new `files.test.ts` 7: type detected from bytes (PDF, PNG, JPEG, GIF, WebP, ZIP/Office, UTF-8 text) and disguised files refused; safe names (no paths, quotes, control characters), executable and HTML extensions refused; bytes go to R2 and metadata to the database with a server-chosen type; 10 MB, 100 files, 200 MB per contract; 503 without the bucket; outsiders 404, non-managing client members 403, inactive contracts 409; downloads are `attachment` + `nosniff` + sandbox CSP for parties and staff only; only the uploader deletes, never a file inside a delivery).
- PostgreSQL 16 with the 0065 DDL, real handlers and an in-memory R2 bucket: upload refused before activation; freelancer PDF and client text uploaded; disguised PNG refused; outsider 404; delivery with the client's file refused (422), with own file accepted; workspace shows the file on the delivery; deleting a delivered file 409, someone else's 403; download bytes identical with the original name; outsider download 404; dispute evidence pack lists both files; moderator can download; client deleted its own file (object removed from the bucket).
- Frontend: typecheck 0 errors (files section and delivery attachments in the workspace, `e2e/files.spec.ts`).
- Python: `tests/test_contract_files_v565.py` (2 tests) compiled; runs in CI.

## Team invitations — 2026-11-18 IST (release 5.63.0)
- Edge API: **275 passed, 0 failed** (new `team.test.ts` 7: email normalisation and 256-bit tokens; owners invite admins/members, admins members only, members nobody, outsiders 404; only the SHA-256 hash is stored; accept needs a valid, pending, unexpired token and the same email; joining runs in one transaction and switches on the client role; a full team refuses without consuming the invitation; in-app invitations only for verified emails; role changes owner-only; admins remove members only; anyone can leave except the owner; ownership transfer in one transaction).
- PostgreSQL 16 with the 0064 DDL, real handlers: invitation stored as hash only; re-inviting the same email replaced the first link (old link 404); preview; wrong account 403 `EMAIL_MISMATCH`; accepted → member with client role; reused link 404; member cannot invite (403); promoted to admin then invited a member; unverified inbox empty, verified inbox 1 → declined; owner cannot leave (403); ownership transferred both ways; non-owner role change 403; member left (status `removed`); a removed member re-joined from a new link (membership re-activated); notifications for invited, owner change and joined.
- **Defect found and fixed during the PostgreSQL run:** `return acceptInvitation(...)` without `await` inside `try/finally` let `sql.end()` run first, so the "joined" notification to managers was silently skipped. Now awaited; every other route file was scanned for the same pattern (none).
- Frontend: typecheck 0 errors (team panel on `/account`, invitations for you, `/join` page, `e2e/team.spec.ts` 2 journeys); unit tests 11/11.
- Python: `tests/test_org_invitations_v564.py` (3 tests) compiled; runs in CI.

## Phase 7 batch 2 — GitHub CI (verified)
Green on the first push. `main` @ 29cf26e: pytest 559 passed; Playwright 46 passed / 2 skipped (bearer), 47 passed / 1 skipped (cookie); Edge @ b0db442: Edge API CI and Full CI success (268/268).

## Phase 7 batch 2 — disputes, suspension and appeals — 2026-11-18 IST (release 5.62.0)
- Edge API: **268 passed, 0 failed** (new `disputes.test.ts` 12: dispute validation and screening; either side opens one per active contract; outsiders 404, non-managing members 403; statements capped; only the opener withdraws; staff-only endpoints; evidence pack without any AI call; money outcomes admin-only; decision logged inside the transaction; same decision re-run is idempotent and a different one 409; suspension of non-staff only, hidden from discovery, notified; appeal decided by a second staff member; one appeal; suspension write-blocking rules).
- PostgreSQL 16 with the 0063 DDL, real handlers, sandbox payments: two contracts with both milestones funded. **Release path:** freelancer opened a dispute, duplicate 409, client statement, client could not withdraw (403), evidence pack (2 milestones, ₹20,000 funded, 7 events), moderator refused for release (403), admin released → 2 milestones released, contract completed, funds held 0 and fees held 0; re-run released 0; different outcome 409. **Refund path:** admin refunded → 2 refunds, contract cancelled, held accounts 0. Trial balance equal (₹1,54,651 each side). Freelancer received 4 dispute notifications. **Suspension:** staff account refused (403); f3 suspended, duplicate 409; auth query reads `suspended = true`; marketplace visibility switched off; appeal once (second 409); suspender could not decide the appeal (403 `SECOND_REVIEWER_REQUIRED`); admin overturned → `suspended_at` cleared, status lifted/overturned; moderation log recorded dispute.release_funded, dispute.refund_funded, user.suspended, appeal.overturned.
- Typecheck: 0 new errors (only the known `mfa-service` harness errors). Bundle builds.
- Frontend: typecheck 0 errors (dispute panel on contracts, disputes and suspensions on `/admin`, suspension card with appeal on `/account`, `e2e/disputes.spec.ts` 3 journeys); unit tests 11/11.
- Python: `tests/test_disputes_suspensions_v563.py` (3 tests) compiled; runs in CI (SQLAlchemy not installed in this workspace).

## Notifications — GitHub CI (verified)
Green on the first push. `main` @ f11562a: Backend tests 556 passed; Full CI success; Edge @ cfa1520: Edge API CI and Full CI success.

## Notifications — 2026-11-17 IST (release 5.61.0)
- Edge API: **256 passed, 0 failed** (new `notify.test.ts` 4: one row per distinct recipient with per-user dedupe, failures never thrown, contract events go to the other party only, inbox list/count/mark limited to the signed-in user).
- PostgreSQL 16 with the 0062 DDL, real handlers: invitation → proposal → shortlist → offer → accept → message → delivery → revision → redelivery produced, for the freelancer: invitation.received, proposal.shortlisted, offer.sent, contract.activated, milestone.revision_requested; for the client: proposal.received, contract.activated, message.received, milestone.submitted ×2 (no self-notifications; redeliveries not swallowed by dedupe); unread count 5 → mark one → mark all → 0.
- Frontend: typecheck 0 errors (`/notifications`, unread badge in headers, `e2e/notifications.spec.ts`).

## Phase 4 batch 2 — GitHub CI (verified)
Green on the first push. `main` @ 03aaca1: 1 skipped   2 skipped   41 passed (20.6s)   42 passed (12.5s) 554 passed, 6 warnings in 16.07s Edge API CI 252/252.

## Phase 4 batch 2 — money loop in test mode — 2026-11-17 IST (release 5.60.0)
- Edge API: **252 passed, 0 failed** (new `payments.test.ts` 9: mode selection (off / sandbox / never live without a provider), HMAC webhook verification and rejection paths, funding/release/refund ledger lines, duplicate events, account naming, payout idempotency key; `delivery.test.ts` adds the funded-first gate).
- PostgreSQL 16 with the 0061 DDL, real handlers, `payments.sandbox` and `payments.require_funding` ON, fee schedule 3.5% + 2.5%: funding refused before activation; delivery refused before funding; freelancer cannot fund; checkout ₹10,350 (₹10,000 + ₹350 fee, freelancer fee ₹250 locked); same Idempotency-Key returned the same checkout; only the creator can complete it; completed → funded; replayed completion = duplicate; second funding refused; delivery → approval **released ₹9,750** to the freelancer; payout above balance refused; payout ₹9,750 paid; repeated payout key returned the same payout; second milestone funded then mutual cancellation (requester cannot accept own request) **refunded** it; invoices (test documents) paid/refunded; outsider 404; webhook with bad signature 401. Ledger after the whole flow: funds held 0, fees held 0, freelancer payable 0, fee revenue ₹600 = provider clearing ₹600; trial balance equal.
- Frontend: typecheck 0 errors (payments panel on contracts with test checkout, invoices and cancellation; `/earnings`; staff payments with refunds on `/finance`; `e2e/payments.spec.ts` 2 journeys).
- Python: `tests/test_payments_sandbox_v561.py` (4 tests) compiled; runs in CI.

## Phase 8 batch 1 — GitHub CI (verified)
Green on the first push. `main` @ ecd5e6a: 1 skipped   2 skipped   38 passed (21.3s)   39 passed (14.8s) 550 passed, 6 warnings in 16.21s Edge API CI 242/242.

## Phase 8 batch 1 — 2026-11-17 IST (release 5.59.0)
- Edge API: **242 passed, 0 failed** (new `public.test.ts` 3: decided values only, "not decided" fees, unavailable parts before migrations, GET-only, no login). Against PostgreSQL the route returned the free plan, `fees: not_decided`, `payments_live: false`.
- Frontend: typecheck 0 errors (`/how-it-works`, `/pricing`, `/safety`, `/help`, links on the sign-in card, `e2e/public.spec.ts` with 2 journeys).

## Phase 7 batch 1 — GitHub CI (verified)
Green on the first push. `main` @ 2f65b5f: 1 skipped   2 skipped   36 passed (20.7s)   37 passed (14.9s) 550 passed, 6 warnings in 15.75s Edge API CI 239/239.

## Phase 7 batch 1 — 2026-11-17 IST (release 5.58.0)
- Edge API: **239 passed, 0 failed** (new `trust.test.ts` 5: report validation, de-duplication and volume limit, staff-only endpoints, approve/return with logged reason in one transaction, action + hide pending review without deletes, admin-only flags with `payments.live` locked).
- PostgreSQL 16 with the 0060 DDL and trigger: a fee-requesting brief was held by the screen and appeared in the queue with `upfront_fee`; return without a reason 422; returned; second decision 409; reports: invalid 422, unknown target 404, created, duplicate open report 409, self-report 422; staff saw the reporter, actioned it and the listing was hidden pending review (`in_review`, `reported:scam`); re-resolve 409; overview counts and flags; moderator cannot change flags (403); `payments.live` refused (409 `FLAG_LOCKED`); the moderation log recorded each decision and **the database refused DELETE on it**.
- Frontend: typecheck 0 errors (`/admin` page, report button on project details, `e2e/admin.spec.ts` with 2 journeys, `/admin` in sign-in guard checks).
- Python: `tests/test_trust_admin_v560.py` (3 tests) compiled; runs in CI.

## Phase 6 batch 2 — GitHub CI (verified)
Green on the first push. `main` @ dbef1da: 1 skipped   2 skipped   33 passed (18.6s)   34 passed (10.8s) 547 passed, 6 warnings in 15.71s Edge API CI 234/234.

## Phase 6 batch 2 — 2026-11-17 IST (release 5.57.0)
- Edge API: **234 passed, 0 failed** (new `assistants.test.ts` 8: keyword coverage with simple word forms, C3 budget/timeline fit and flags without ranking, C5 exact split of the freelancer's price with remainder on the last milestone and dates spread to the deadline, missing-term flags, C6 checklist, route switch/membership/run recording).
- PostgreSQL 16, real handlers: C3 compared two proposals (within/fits vs below/not stated with flags; disclaimer; outsider 404); C5 split ₹25,000.01 into ₹8,333 + ₹8,333 + ₹8,334.01 (sum exact) with dates to the deadline and an ownership flag, then used as the actual offer; C6 refused before delivery (409), checked both criteria after delivery, hidden from the freelancer (404); each wrote an agent run; switching C3 off returned 403 `AGENT_DISABLED`.
- Frontend: typecheck 0 errors (comparison table, suggested terms in the offer form, acceptance checklist in reviews, new Playwright journey).
- Python: registry test extended for migration 0059 (data-only); runs in CI.

## Phase 6 batch 1 — GitHub CI (verified)
Green on the first push. `main` @ c18e3fc: 1 skipped   2 skipped   32 passed (19.8s)   33 passed (10.8s) 546 passed, 6 warnings in 15.86s Edge API CI 226/226.

## Phase 6 batch 1 — 2026-11-17 IST (release 5.56.0)
- Edge API: **226 passed, 0 failed** (new `agents.test.ts` 5: operation→agent map, registry tolerance, governor refusal for a disabled agent with no usage row written, catalogue in both shapes without internal runtime names, run labelling and filtered query, admin-only switch).
- PostgreSQL 16 with the 0058 DDL and the 28 seeded agents (4 live, 4 partly built, 17 planned, 3 blocked): catalogue ordered freelancer → client → platform; legacy `/agents/registry` shape; my runs labelled (`match_shortlist` → C2) and filtered by agent; non-admin toggle 404; invalid value 422; switching F4 off made the real governor refuse `proposal_draft` (template used) while C1 stayed allowed; switched back on.
- Frontend: typecheck 0 errors (`/ai-agents` page, sidebar link, `e2e/agents.spec.ts`, `/ai-agents` in sign-in guard checks).
- Python: `tests/test_agent_registry_v558.py` (4 tests: catalogue codes F1–F12/C1–C7/P1–P9, valid ceilings/status/gates, planned/blocked agents claim no runtime names, money agents blocked and nothing above A3) compiled; runs in CI.

## Phase 5 batch 1 — GitHub CI (verified)
Green on the first push. `main` @ b262099: pytest 542 passed; Playwright 30 passed / 2 skipped (bearer), 31 passed / 1 skipped (cookie). Edge API CI 221/221.

## Phase 5 batch 1 — 2026-11-17 IST (release 5.55.0)
- Edge API: **221 passed, 0 failed** (new `plans.test.ts` 7: plan limits from the user's plan, the free plan or the Worker defaults when plan tables are missing; one credit per call beyond the monthly limit, never beyond the daily limit; missing credit table = 0; plan validation; admin-only routes; idempotent credit grants; the free plan cannot be retired). Existing `ai-governor.test.ts` unchanged and passing. Bundle 478 KB.
- PostgreSQL 16 with the 0057 DDL: free plan limits 20/300 apply by default; admin creates a draft plan (invalid 422, duplicate 409), cannot grant a draft (422), activates it, cannot retire `free` (409), unknown email 404, grants the plan (email match is case-insensitive) → limits switch to 2/day, 3/month → real governor calls: ok, ok, daily limit, daily limit → credit grant (repeat with the same grant id writes nothing) → ok, ok + 1 credit spent, monthly limit, monthly limit → `/me/plan` shows plan, usage and 0 credits left.
- Frontend: typecheck 0 errors (Account plan card, admin plan tools on `/finance`, new `e2e/plans.spec.ts`; finance e2e label made exact because a "Plan name" field now exists).
- Python: `tests/test_plans_credits_v557.py` (3 tests) compiled; runs in CI.

## Phase 4 batch 1 — GitHub CI (verified)
Green on the first push; the CI migration job ran 0056 (with the trigger SQL) on real PostgreSQL. `main` @ 6eb6041: pytest 539 passed; Playwright 29 passed / 2 skipped (bearer), 30 passed / 1 skipped (cookie). Edge API CI 214/214.

## Phase 4 batch 1 — 2026-11-17 IST (release 5.54.0)
- Edge API: **214 passed, 0 failed** (new `ledger.test.ts` 9: entry validation incl. live refusal, natural balances, one-transaction posting and idempotent repeats, half-up rounding, minimum-fee top-up, schedule bounds, staff-only routes, approval by admin only with retirement of the previous schedule). Typecheck clean.
- PostgreSQL 16 with the 0056 DDL and its trigger SQL (extracted verbatim from the migration): balanced sandbox entry posted; repeated idempotency key returned the same entry with nothing written; live / unbalanced / fractional entries refused by code; an unbalanced entry inserted directly with SQL **rejected by the database at commit**; UPDATE and DELETE on ledger rows **rejected by the database**; reversal entry posted; trial balance totals equal; finance API: non-staff 404, quote 409 until a schedule is approved, invalid schedule 422, finance cannot approve (403), admin approves, re-approve 409, quotes ₹10,000 → client ₹350 / freelancer ₹250, ₹500 → minimum ₹50 topped up on the client side.
- Frontend: typecheck 0 errors (fee estimate on contracts, `/finance` staff page, new `e2e/finance.spec.ts` with 2 journeys, `/finance` added to sign-in guard checks).
- Python: `tests/test_ledger_foundation_v556.py` (3 tests) compiled; runs in CI (the CI migration check runs 0056 on real PostgreSQL, including the triggers).

## Phase 3 batch 3 — GitHub CI (verified)
Green on the first push. `main` @ 1a525aa: pytest 536 passed; Playwright 26 passed / 2 skipped (bearer), 27 passed / 1 skipped (cookie). Edge API CI 205/205.

## Phase 3 batch 3 — 2026-11-17 IST (release 5.53.0)
- Edge API: **205 passed, 0 failed** (new `review.test.ts` 6: pending-change detection and per-party actions, delivered-milestone locks, reveal rule, rating/comment validation, review routes incl. window, owner/admin, duplicates, hidden reviews; `matching.test.ts` covers the rating on cards). Typecheck clean; bundle 458 KB.
- PostgreSQL 16 (0055 DDL + backfill), real handlers end to end: activation sets `agreed_version` → delivery → change order that alters a delivered milestone refused (422) → valid change order (adds a milestone) leaves the workspace on the agreed 2 milestones while pending → reject → accept refused (nothing pending) → new change order → **version numbering bug found and fixed** (after a rejection the next version reused number 2 and hit the unique constraint; versions now continue from the highest number) → both accept → workspace shows 3 milestones → all approved → completed → reviews: invalid rating 422, client review hidden from the freelancer, duplicate 409, freelancer review reveals both → freelancer card shows ★ 5 (1) only after reveal.
- Frontend: typecheck 0 errors (change-order banner/actions, reviews panel, ratings on cards, new e2e review journey).
- Python: `tests/test_change_orders_reviews_v555.py` (2 tests) compiled; runs in CI.

## Phase 3 batch 2 — GitHub CI (verified)
First run: 1 Playwright failure — the offer-acceptance test's catch-all mock returned `[]` for the new workspace call and the page crashed; fixed by validating the reply shape in the component (and mocking the call). Re-run on `main` @ 040ca84: pytest 534 passed; Playwright 25 passed / 2 skipped (bearer), 26 passed / 1 skipped (cookie). Edge API CI 199/199.

## Phase 3 batch 2 — 2026-11-17 IST (release 5.52.0)
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **199 passed, 0 failed** (new `delivery.test.ts` 9: milestone state derivation, https-only links, party-only workspace, freelancer-only delivery, one open delivery per milestone, revision limit and required reason, owner/admin review, completion only when all milestones approved, message screening/closing; `hiring.test.ts` now also checks the activity-log insert). Typecheck clean; bundle 447 KB.
- PostgreSQL 16 with the 0054 DDL, real handlers end to end: offer → message during negotiation → delivery refused before activation → accept → stranger 404 → contact-detail message 422 → client cannot deliver → http link 422 → deliver → second delivery 409 → missing milestone 404 → revision without reason 422 → revision → redeliver → revision over the 1 agreed round 409 → approve → nothing to review 409 → second milestone → approve → contract **completed**; workspace shows ₹15,000/₹15,000 approved and the full activity trail (offer.sent → terms.accepted → contract.activated → … → contract.completed); messages closed after completion.
- Frontend: typecheck 0 errors (new workspace component, 5 e2e specs incl. a new deliver-and-approve journey); `npm run test:unit` 11/11.
- Python: `tests/test_delivery_workspace_v554.py` (3 tests) compiled; runs in CI.

## Phase 3 batch 1 — GitHub CI (verified)
Edge API CI 190/190; `main` @ c404d6d: pytest 531 passed; Playwright 24 passed / 2 skipped (bearer), 25 passed / 1 skipped (cookie). Green on the first push.

## Phase 3 batch 1 — 2026-11-17 IST (release 5.51.0)
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **190 passed, 0 failed** (new `hiring.test.ts` 17: proposal and terms validation, server-computed totals, screening, party actions, route isolation from the existing `/proposals` routes, invite-only/member/closed checks, owner/admin rules, one-transaction offers, activation only on matching versions, stale/double acceptance, counter-proposals). Typecheck clean; bundle builds (432 KB).
- PostgreSQL 16 with the 0053 DDL, real handlers end to end: proposals (role, validation, screening, duplicate, edit) → client list (outsider 404) → decline/shortlist → invalid offer 422 → offer v1 → duplicate offer 409 → other freelancer 404 → counter-offer v2 (total recomputed) → double accept 409 → stale accept 409 → client accepts v2 → active, proposal hired, listing hiring → withdraw refused → deleting a user with a contract is blocked by RESTRICT.
- Frontend: typecheck 0 errors (incl. new `/contracts` page, terms form, proposal and offer panels, 5 e2e specs); `npm run test:unit` 11/11 (new exact-amount formatter test). Playwright runs in CI (new `e2e/hiring.spec.ts`, 3 journeys; `/contracts` added to the sign-in guard checks).
- Python: `tests/test_proposals_contracts_v553.py` (4 tests) compiled; runs in CI.

## Phase 2 batch 2 — 2026-11-17 IST (release 5.50.0)
- **GitHub CI (verified):** Edge API CI 173/173 (vitest, 14 files); Backend tests + Full CI on `main` @ 9bbacbe: pytest 527 passed; Playwright 20 passed / 2 skipped (bearer) and 21 passed / 1 skipped (cookie). First push failed on two real defects, both fixed: revision id longer than `alembic_version`'s 32 characters, and the opt-in checkbox only changing after the API reply.
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **173 passed, 0 failed** (new `matching.test.ts` 22; `listings.test.ts` now 25 with closing-date tests). Typecheck clean (TS-6-only `mfa-service.ts` messages excluded, as before). Worker bundle builds (402 KB).
- PostgreSQL 16 with the 0052 DDL: the **real route handlers** were run end to end with the real driver: create invite-only listing with closing date → publish → matches (hidden freelancer excluded, newcomer flagged) → invite-only listing hidden before invitation, visible to the invitee only → duplicate invite 409 → hidden freelancer 404 → other user's invitation 404 → accept → second answer 409 → withdraw → re-invite → saved-freelancer upsert → outsider 404 → opt-in/out → closing-date-only edit keeps version 1 → expiry marks the listing expired. `= ANY(text[])` parameter verified.
- Frontend: typecheck 0 errors (pages, components, all 4 e2e specs incl. 2 new Playwright tests); `npm run test:unit` 10/10. Playwright runs in CI.
- Python: `tests/test_invitations_saved_v552.py` (5 tests) compiled; runs in CI.

## Phase 2 batch 1 — 2026-11-17 IST (release 5.49.0)
- Edge API (real `postgres` 3.4.9 + `bcryptjs`): **149 passed, 0 failed** (new `listings.test.ts` 23: validation, lifecycle, screening, public projection, Brief Builder guard/quota/fallback, routes incl. non-member 404s, owner-only transitions, version conflicts, re-screening). Typecheck clean; bundle builds.
- PostgreSQL 16: 0051 DDL; marketplace query with bound parameters (filters, search, keyset paging; excludes draft/private/expired/closed-org); FOR UPDATE + new version; unique version, budget range, status and category FK rejections.
- Frontend: typecheck 0 errors (incl. new pages and 4 e2e specs); `npm run test:unit` 10/10 (new money-conversion tests); render smoke of `/client/projects` and `/projects`. Playwright runs in CI.
- Python: `tests/test_project_listings_v551.py` compiled (runs in CI); category seed checked directly (8 categories, only website_development enabled).


## Full CI run #370 — root cause found (2026-11-17 20:05 IST)
The recurring "login failure…" e2e failure was in the **cookie-mode** Playwright pass (15 tests: 13 passed, 1 skipped, 1 failed). In cookie mode the page calls `GET /api/v1/me` to detect a session; the test's catch-all mock answered 200, so the page treated the visitor as signed in and never showed the login form (in `next dev` the form appeared, then vanished — the earlier "detached" message). Earlier explanations (parallel compilation, dev-server reloads) were wrong. Fix: the mock returns 401 for `/me` until a login succeeds, like the real API. The production-build Playwright setup is kept (it tests what ships).


## Full CI run #357 — 2026-11-17 19:50 IST
`frontend-e2e`: 13 passed, 1 skipped, 1 failed — the same "login failure" test (input repeatedly detached before typing), even with one worker, so the parallel-compile explanation was incomplete. Change: CI Playwright now runs against a production build instead of `next dev`. Verified in Next.js source that `next start` with `output: 'standalone'` only warns. Not runnable here (no npm registry); confirm on the next CI run.


## Phase 1 batch 1 — 2026-11-17 IST (release 5.48.0)
- Edge API with real `postgres` 3.4.9 + `bcryptjs`: **126 passed, 0 failed** (new `identity.test.ts` 19: roles, organisation validation, flag gating, cross-account 404s, owner-only edits, billing visibility, transactions, rate limiting). Typecheck clean (TS-6-only `mfa-service.ts` messages excluded, as before).
- PostgreSQL 16: migration 0050 DDL, idempotent backfill, check constraints, role toggle, membership lookups (outsider gets 0 rows), account deletion not blocked (`SET NULL`).
- Frontend: typecheck 0 errors (pages, lib, all three e2e specs); `npm run test:unit` 6/6; server-render smoke test of `/account` and `/`. Playwright not run here (CI runs it in bearer and cookie modes).
- Python: `tests/test_identity_roles_v550.py` compiled, runs in CI.


## Batch 2 CI follow-up — 2026-11-17 19:15 IST
Full CI run #329: (1) `test:unit` failed because the test file was uploaded as `api-clients.test.mts`; renamed. (2) Playwright: 10 passed, 1 skipped, 1 failed ("login failure…": login input repeatedly detached = dev-server reload while other pages compiled in parallel; the identical success-login test passed). Fix: one Playwright worker in CI. Re-verified on the live branch files: `npm run test:unit` 6/6, frontend typecheck 0 errors.

## Phase 0 batch 2 — 2026-11-17 19:xx IST
- Edge API (`cloudflare-edge-api-phase1` @ batch-2 commit), real `postgres` 3.4.9 + `bcryptjs` 3.0.2: **107 passed, 0 failed** (11 files; new `ai-guard.test.ts` 23). Bundle builds (333 KB) with the guard; eval JSON not bundled.
- Frontend: strict typecheck of all pages, `lib/`, both e2e specs and `playwright.config.ts` with real React 18 + Playwright 1.63 types: 0 errors (baseline 0). `npm run test:unit`: 6/6. `next build` and Playwright were not run here (npm registry unreachable) — CI runs both, including a second Playwright pass with `E2E_AUTH_MODE=cookie`.
- Workers Build #8f8b52e3 (batch 1) ran the real vitest: 84/84.


## Update 2026-11-17 18:30 — Edge API CI failure fixed
GitHub "Edge API CI" run #28 failed typecheck with 10 errors. Reproduced exactly with the real `postgres` 3.4.9 types (installed from GitHub) and fixed:
- `src/lib/job-routes.ts` had been uploaded as `job_routes.ts` (renamed).
- postgres ≥ 3.4.8: `TransactionSql` is no longer a subtype of `Sql`; query helpers now accept `Queryable = Sql | TransactionSql`.
After the fix, with real `postgres` 3.4.9 and real `bcryptjs` 3.0.2: typecheck clean (except TS 6-only `mfa-service.ts` messages your CI's TS 5.9 does not report), **84 passed, 0 failed** (the 4 password tests now run), Worker bundle builds with `fetch`, `scheduled`, `queue`.


Run on 2026-11-17 in an offline build container (no package downloads). Results are reported exactly; nothing below is a CI or production result.

## Edge API (`backend/edge-api`)
Runner: the repository's own `*.test.ts` files executed with `tsx` and a local stand-in for the vitest API (vitest, `postgres`, `bcryptjs` and `@cloudflare/workers-types` could not be installed).

| Suite | Result |
|---|---|
| account-routes (new) | 16 passed |
| ai-governor (new) | 11 passed |
| auth-context (new) | 9 passed |
| jobs (new) | 11 passed |
| token-crypto (new) | 11 passed |
| apply-agent | 4 passed |
| discovery-agent | 7 passed |
| project-sources | 4 passed |
| scoring | 5 passed |
| password-service | 2 passed, **4 not runnable** (needs real `bcryptjs`; environment, not a code defect) |
| **Total** | **80 passed, 4 not runnable** (baseline before this batch: 22 passed + same 4) |

Typecheck (`tsc --noEmit`, TypeScript 6 with stub types): 0 new errors versus baseline; 11 pre-existing harness-only errors (bcryptjs stub typing, TS 6 DOM `BufferSource`). Bundle (`esbuild`): builds, 218 KB, exports `fetch`, `scheduled`, `queue`, contains no test code.

## Database (real PostgreSQL 16.15)
- 0047 DDL, fresh and hand-made-table paths, then every Edge SQL statement shape for the three tables: pass; duplicate live send and duplicate message rejected; failed send allowed.
- Job queue: idempotent enqueue, two consumers racing (one claims), duplicate delivery after success (not re-run), stale claim (reclaimed after 15 min), fresh claim (not reclaimed): pass.
- AI usage aggregation: per-user day/month counts across services and global daily cost: pass.
- Alembic itself was **not** executed (SQLAlchemy/Alembic unavailable offline).

## Python backend
- New/changed tests: `tests/test_edge_apply_tables_v546.py`, `tests/test_system_diagnostics_v542.py`. Byte-compiled only; **not run** (FastAPI/SQLAlchemy unavailable). The migration-head logic was executed directly: single head `0049_feature_flags_ai_cost`.
- Historical baseline (Progress Report): 495 passed, 12 skipped.

## Frontend
New files (`app/api/v1/[...path]/route.ts`, `lib/api-client.ts`) pass an isolated strict typecheck. `next build`, ESLint and Playwright were **not run**.

## Must run in CI before deploy
`Full CI` (pytest + Alembic on pgvector + frontend build + Playwright) and the new `Edge API CI` (clean npm install, typecheck, vitest, wrangler dry-run).


## 5.75.0 (U9) — local
- Edge: 363 passed, 0 failed (new `discussion.test.ts` 8; `agents.test.ts` and `notify.test.ts` expectations updated to the text-array parameter). Typecheck clean (known mfa-service noise excluded); bundle builds.
- PostgreSQL 16 end-to-end through the real handlers: 503 before tables; messages both sides plus a client member; contact details refused (422); outsider 404; member cannot schedule (403); non-allowlisted link refused (422); proposer cannot accept own time (403); accept, accept again (409), complete early (409), cancel; calendar shows the interview; inbox merges proposal and contract threads; notifications to the other side; hired proposal closed (409). Re-ran next actions, overview, calendar, jobs filter, agent runs, notifications read and opportunity timeline after the array fix: all 200.
- Frontend: strict typecheck app + e2e clean; unit tests 31 passed. Playwright, pytest and Alembic run in CI.
