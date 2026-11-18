# Business Decision Register

Founder decisions are marked DECIDED with their date (D-5, D-6, D-20, D-21 on 2026-11-18). Everything else is open or provisional.

| ID | Decision | Status | Blocks | Recommendation / note |
|---|---|---|---|---|
| D-1 | Operating country, legal entity, GST/tax registration | BLOCKED — legal/accounting | Phase 4 money movement, invoices | Professional advice required. |
| D-2 | Payment provider and marketplace flow (split settlement, payouts, KYC, refunds, chargebacks, webhooks) | BLOCKED — external provider | Phase 4 | Shortlist Indian providers with marketplace/route-split products; get written confirmation of the intended flow before code. `payments.live` stays OFF. |
| D-3 | Default payment mode (funded-first milestones vs postpaid with caps) | BLOCKED — user approval | Phase 4 | Plan default: funded-first for new clients. |
| D-4 | Who bears unpaid-work loss | BLOCKED — user approval | Terms, Phase 4 | Must be explicit in terms. |
| D-5 | Fee level/split/minimum | DECIDED 2026-11-18 (founder) | Fee engine values | **5% from the client + 3% from the freelancer**, minimum 0. Entered by the founder as an approved fee schedule in `/finance` (500 / 300 basis points); applies to test-mode payments now and to live payments once D-1/D-2 allow them. Revisit with real provider costs. |
| D-6 | Categories open at launch | DECIDED 2026-11-18 (founder) | Posting and services | **All 8 categories open** (migration 0075). Admins can close any category from `/admin` → Work categories (reason logged). |
| D-7 | Launch geography/currency | Assumed India / INR (Master Plan) | — | Confirm. |
| D-8 | Approved external sources and permission owner | BLOCKED — user approval | Source registry | Remotive and Jobicy are in use; record terms URLs and permitted fields. |
| D-9 | Support owner and hours | BLOCKED — user approval | Phase 7 | — |
| D-10 | Founder weekly capacity | BLOCKED — user approval | Roadmap dates | — |
| D-11 | Architecture option A/B/C | BLOCKED — user approval | Route porting order, hosting cost | Recommend A (Edge only; Python as reference). See ADR-006. |
| D-12 | Agent autonomy ceilings | Defaults from Master Plan 3.5 applied | — | Confirm. |
| D-13 | AI provider/model/data policy | BLOCKED — user approval | Agent platform | Workers AI in use today. |
| D-14 | Agent pricing/credits, plans (₹299/₹699/₹999/₹2,499; packs ₹99–₹999) | BLOCKED — user approval | Phase 5 values | Hypotheses only; build configurable. |
| D-16 | Contact details in contract messages after hiring (currently blocked like everywhere else) | BLOCKED — user approval | Messaging policy | Keep blocked until calls/meetings exist (K-25). |
| D-17 | Minimum-fee rule | Provisional (code) | Fee engine | Minimum applies to the combined platform fee; any top-up is charged on the client side. Change in `lib/fees.ts` if D-5 decides otherwise. |
| D-18 | Dispute outcomes | Provisional (code) | Dispute policy text | Staff choose one of three outcomes: release all funded milestones, refund all funded milestones, or no money moves. Partial splits are not offered until a written dispute policy (and D-1 legal review) defines them. |
| D-19 | Who decides trust actions | Provisional (code) | — | Moderators or admins suspend, lift and decide `no_action`; only admins decide outcomes that move money; an appeal is decided by a different staff member than the one who suspended. |
| D-15 | Resend account and sending domain | BLOCKED — external provider | Email verification, password reset in production | Free tier is enough for beta volumes; verify current limits on resend.com. |
| D-20 | Fiverr-style services alongside projects | DECIDED 2026-11-18 (founder) | Service catalogue (U18) | Freelancers may sell ready-made packages (Basic/Standard/Premium); an order becomes a normal two-party contract (freelancer accepts; payment per milestone, test mode until D-1/D-2). Prices set only by the freelancer. |
| D-21 | One account for both sides; platform staff separate | DECIDED 2026-11-18 (founder) | Identity | Like Upwork/Fiverr: one login can hold freelancer and client roles. Staff roles (admin, finance, moderator) are granted only by the founder through the GitHub workflow; no app screen can grant them. Recommended at launch: a separate staff-only email. |
| D-22 | Automatic approval of hourly weeks the client does not review | OPEN — user approval | Hourly payouts | Upwork approves automatically after 5 days. Today every week needs the client's explicit approval; no money moves without it. |
