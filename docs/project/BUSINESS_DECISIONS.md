# Business Decision Register

No founder decisions were found recorded in the repositories or documents. Every item is open; nothing below is approved.

| ID | Decision | Status | Blocks | Recommendation / note |
|---|---|---|---|---|
| D-1 | Operating country, legal entity, GST/tax registration | BLOCKED — legal/accounting | Phase 4 money movement, invoices | Professional advice required. |
| D-2 | Payment provider and marketplace flow (split settlement, payouts, KYC, refunds, chargebacks, webhooks) | BLOCKED — external provider | Phase 4 | Shortlist Indian providers with marketplace/route-split products; get written confirmation of the intended flow before code. `payments.live` stays OFF. |
| D-3 | Default payment mode (funded-first milestones vs postpaid with caps) | BLOCKED — user approval | Phase 4 | Plan default: funded-first for new clients. |
| D-4 | Who bears unpaid-work loss | BLOCKED — user approval | Terms, Phase 4 | Must be explicit in terms. |
| D-5 | Fee level/split/minimum (candidate 3.5% client + 2.5% freelancer) | BLOCKED — user approval | Fee engine values (engine itself can be built configurable) | Model with real provider quotes first. |
| D-6 | First category and client segment | BLOCKED — user approval | Phase 2 category template | Pick one narrow category. |
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
