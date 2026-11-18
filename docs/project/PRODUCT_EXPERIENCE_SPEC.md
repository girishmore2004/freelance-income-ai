<!-- Authoritative addendum to Master Plan v2, provided by the founder on 2026-11-18. Do not edit the requirements; record deviations in ARCHITECTURE_DECISIONS.md or BUSINESS_DECISIONS.md. -->

# ADDITIONAL PRODUCT VISION & COMPLETE UI/UX SPECIFICATION
## Freelance Income AI — AI-Agent-Native Freelance Marketplace

Claude, incorporate the following product vision, interface architecture, user journeys and functional expectations into the existing master implementation instructions. This is an essential addition to the original business requirements, not a replacement for them.

The objective is to build a complete, professional, globally accessible freelance marketplace powered by specialised AI agents. Do not turn this into a simple freelancer dashboard, job aggregator, proposal generator or generic AI chatbot.

# 1. WHAT THE PLATFORM SHOULD LOOK LIKE

Freelance Income AI should look like a premium, modern SaaS marketplace with the usability of Upwork, the service-discovery experience of Fiverr, the productivity of Linear, and the intelligence of an advanced AI workspace.

The platform should have:
- A beautiful public-facing marketplace website.
- A separate authenticated freelancer workspace.
- A complete client hiring workspace.
- An integrated AI Agent Command Centre.
- A project delivery and collaboration workspace.
- A financial and earnings management system.
- A comprehensive administration and platform operations dashboard.

All these experiences must feel like one connected product with consistent navigation, design language, data and functionality.

# 2. PUBLIC WEBSITE — FIRST IMPRESSION

The public website is the primary acquisition and conversion experience.

## Homepage

Create a premium homepage with:

1. A professional navigation bar containing Logo, Find Work, Hire Freelancers, Categories, How It Works, Pricing, Login and Get Started.
2. A powerful hero section explaining how AI helps freelancers discover opportunities and helps businesses hire the right talent.
3. Two clear primary actions: Find Freelance Work and Hire Talent.
4. A prominent intelligent search bar where visitors can search freelance projects, services, skills and freelancers.
5. Featured freelance opportunities with budget, skills, source, posting date and availability.
6. Popular freelance categories such as Web Development, Software Development, UI/UX, Graphic Design, Content Writing, Video Editing, Digital Marketing and AI Automation.
7. Featured freelancer profiles with portfolios, skills, genuine reviews and availability.
8. An explanation of the AI-powered freelance workflow.
9. A section demonstrating the AI Agent ecosystem.
10. Success stories and verified marketplace statistics, only when actual data exists.
11. Clear pricing, platform fee explanation, trust and safety information.
12. A strong final registration and conversion section.

## Public marketplace pages

Build individual, SEO-friendly pages for:

- Browse Projects.
- Project Details.
- Browse Freelancers.
- Freelancer Public Profiles.
- Browse Services.
- Freelance Categories.
- How It Works.
- Pricing and Fees.
- AI Features.
- Safety and Trust.
- Help Centre.
- About.
- Contact.
- Terms, Privacy, Refunds and Disputes.

Every public opportunity must clearly indicate whether it is an external listing or a native project posted by a registered client.

External listings must show the original source and direct application link. Never represent an external listing as a native marketplace transaction.

# 3. FREELANCER WORKSPACE — COMPLETE EARNING ENVIRONMENT

After login, freelancers should enter a personalised workspace.

Use a consistent desktop application layout:

LEFT SIDEBAR:
- Overview
- Discover Opportunities
- My Applications
- Proposals
- Inbox
- Interviews and Discussions
- Offers and Contracts
- My Projects
- Deliveries
- Calendar and Schedule
- Portfolio
- AI Agent Centre
- Earnings and Finance
- Analytics
- Learning and Recommendations
- Settings

TOP NAVIGATION:
- Global search.
- AI command input.
- Notifications.
- Inbox indicator.
- AI usage or credits.
- Profile menu.

MAIN DASHBOARD:

The dashboard should answer five questions immediately:
1. What opportunities should I apply for?
2. What is happening with my existing applications?
3. What work must I complete?
4. How much money have I earned or am I expecting?
5. What should I do next?

Display:
- Personalised welcome and profile completion.
- Relevant opportunity recommendations.
- Native project invitations.
- External opportunities.
- Application pipeline.
- Proposal response statistics.
- Active projects.
- Upcoming deadlines.
- Pending deliverables and revisions.
- Pending payments and payout status.
- Monthly earnings and financial trends.
- AI recommendations.
- Recent agent activities.

Do not overcrowd the dashboard. Use meaningful cards, tables, charts and actionable sections.

# 4. OPPORTUNITY DISCOVERY — THE CORE FREELANCER EXPERIENCE

This should be one of the strongest features.

Build a discovery interface with:

- Search by keyword, skill, project type and category.
- Filters for budget, currency, experience, deadline, source and work type.
- Sort by relevance, newest, budget and match quality.
- Native and external opportunity filters.
- Saved opportunities.
- Personalised recommendations.
- Duplicate detection.
- Expired listing detection.
- Opportunity freshness indicators.

Each opportunity card should show:
- Project title.
- Short description.
- Budget, if disclosed.
- Skills required.
- Experience requirements.
- Deadline, if disclosed.
- Source platform.
- Posted and last-checked information.
- Opportunity type.
- AI match percentage, only when backed by a defined and evaluated scoring system.
- Reasons why it matches the freelancer.

PROJECT DETAIL PAGE:

Show the complete available project information, requirements, skills, commercial terms and original source.

Include an AI analysis panel:
- Why this project matches.
- Skills the freelancer already possesses.
- Missing skills or qualifications.
- Project risks.
- Budget suitability.
- Deadline suitability.
- Relevant portfolio evidence.
- Recommended application strategy.

Actions:
- Save.
- Analyse with AI.
- Generate Proposal.
- Track Application.
- Open Original Source.

External applications must happen on the original platform unless a permitted integration explicitly supports submission.

# 5. AI PROPOSAL STUDIO

Create a dedicated professional proposal editor.

The workflow:

Opportunity selection → Project analysis → Portfolio retrieval → Proposal generation → Editing → Evidence validation → Human approval → Submission.

The editor should contain:
- Project requirements.
- Freelancer introduction.
- Relevant experience.
- Portfolio references.
- Proposed solution.
- Deliverables.
- Timeline.
- Pricing.
- Assumptions.
- Exclusions.
- Clarification questions.
- Final proposal preview.

AI capabilities:
- Generate tailored proposals.
- Use confirmed freelancer information.
- Retrieve relevant portfolio evidence using RAG.
- Identify unsupported claims.
- Improve clarity and professionalism.
- Adjust tone.
- Check budget and timeline consistency.
- Suggest missing information.

Provide editable drafts and version history.

The freelancer must explicitly approve the exact proposal before submission. No autonomous mass bidding or fabricated experience.

# 6. AI AGENT COMMAND CENTRE

This is one of the most important differentiators.

Create a dedicated AI Agent Centre that feels like an intelligent operational command centre.

It should contain:

A. Agent Overview:
- Available agents.
- Agent status.
- Current tasks.
- Completed runs.
- Failed runs.
- Pending approvals.
- AI consumption.
- Execution history.

B. Specialist Agents:

Freelancer agents:
- Opportunity Discovery Agent.
- Opportunity Fit and Risk Agent.
- Proposal Generation Agent.
- Profile Optimisation Agent.
- Portfolio Intelligence Agent.
- Inbox and Communication Agent.
- Interview Preparation Agent.
- Delivery Planner Agent.
- Delivery Quality Agent.
- Finance and Cash-Flow Agent.
- Reputation Builder Agent.
- Freelancer Business Intelligence Agent.

Client agents:
- Project Brief Builder.
- Freelancer Matching Agent.
- Proposal Comparison Agent.
- Interview Preparation Agent.
- Contract and Milestone Assistant.
- Review and Acceptance Assistant.
- Client Spend and Outcomes Intelligence Agent.

Platform agents:
- Trust and Safety Agent.
- Payment Risk Agent.
- Dispute Assistant.
- Customer Support Agent.
- Source Compliance Agent.
- Reconciliation Agent.
- Marketplace Growth and Balance Agent.

C. Agent Interaction:
Users should be able to:
- Open an individual agent.
- Understand its purpose.
- Ask questions.
- Give it a task.
- Attach authorised documents.
- Review its reasoning and evidence.
- Approve, edit or reject its outputs.
- See execution history.
- Configure permissions and autonomy.
- Monitor usage and cost.

D. AI Command Bar:

Make AI accessible throughout the application through a persistent command interface.

Example commands:
- Find suitable projects for my skills.
- Analyse this opportunity.
- Create a proposal using my portfolio.
- Find clients who need AI automation.
- Summarise my pending applications.
- Prepare me for tomorrow's interview.
- Identify projects at risk of missing deadlines.
- Summarise my earnings this month.

The command centre must understand the user's role, permissions and relevant workspace context.

# 7. CLIENT WORKSPACE — COMPLETE HIRING ENVIRONMENT

Clients should have their own dedicated experience rather than seeing a modified freelancer dashboard.

LEFT SIDEBAR:
- Overview.
- Post a Project.
- My Projects.
- Discover Freelancers.
- Proposals.
- Shortlists.
- Discussions.
- Interviews.
- Offers and Contracts.
- Active Contracts.
- Deliveries and Reviews.
- Payments and Invoices.
- Reviews and Rehiring.
- AI Agent Centre.
- Analytics.
- Settings.

CLIENT DASHBOARD:

Show:
- Active projects.
- Draft projects.
- Published projects.
- New proposals.
- Shortlisted freelancers.
- Pending discussions.
- Active contracts.
- Deliverables awaiting review.
- Upcoming milestones.
- Outstanding invoices.
- Recent activity.
- AI recommendations.

# 8. INTELLIGENT PROJECT POSTING WIZARD

Create a multi-step project creation experience.

Step 1: Describe the business requirement.

Step 2: Select the freelance category.

Step 3: Define deliverables and expected outcomes.

Step 4: Set budget and commercial model.

Step 5: Define deadlines and milestones.

Step 6: Select skills and experience requirements.

Step 7: Upload references and supporting files.

Step 8: Define revisions and acceptance criteria.

Step 9: Set visibility: Public, Invite-only or Private.

Step 10: Review and publish.

AI should convert an informal description into a structured project brief, ask relevant questions, identify missing information, suggest milestones and flag conflicting requirements.

The client must review and confirm the final brief before publication.

# 9. FREELANCER DISCOVERY AND PROPOSAL COMPARISON

Clients should be able to browse freelancer profiles and portfolios.

Include:
- Skills.
- Experience.
- Verified work history.
- Portfolio.
- Pricing.
- Availability.
- Genuine reviews.
- Relevant project evidence.

When proposals arrive, provide a powerful comparison workspace.

Compare:
- Work price.
- Total client cost.
- Timeline.
- Deliverables.
- Milestones.
- Relevant portfolio evidence.
- Assumptions.
- Exclusions.
- Availability.
- Reviews.
- Clarification questions.

AI should explain strengths, risks and differences without automatically treating the cheapest proposal as the best.

Actions:
- Shortlist.
- Ask Questions.
- Invite to Discussion.
- Request Revision.
- Send Offer.
- Decline.
- Report.

# 10. INBOX AND COLLABORATION

Build a unified communication experience.

Features:
- Native client-freelancer messaging.
- Conversation history.
- Project-linked discussions.
- File attachments.
- Notifications.
- Search.
- Unread indicators.
- Email integration where authorised.
- Reply drafting using relevant project and portfolio context.
- Follow-up reminders.

AI can summarise conversations, detect urgency and prepare responses.

Messages must remain private to authorised participants.

Sending messages must follow explicit approval requirements.

# 11. CONTRACT AND PROJECT DELIVERY WORKSPACE

Every native contract should create a dedicated shared workspace.

Include tabs:

1. Overview.
2. Agreement.
3. Milestones.
4. Tasks.
5. Timeline.
6. Files and Deliverables.
7. Messages.
8. Revisions.
9. Activity.
10. Invoices and Payments.
11. Handover.

The project lifecycle should be:

Offer → Both parties accept the same agreement version → Project becomes active → Work begins → Milestone submission → Client review → Revision if required → Acceptance → Payment → Closeout.

Support:
- Fixed-price projects.
- Milestone-based projects.
- Hourly projects.
- Retainers.
- Sessions.
- Per-unit billing.

The delivery process should change according to the work category.

For example, a website development project should have requirements, design, development, testing, staging, approval and deployment stages.

A graphic design project should have creative direction, initial concepts, review, revisions, final assets and source-file handover.

AI should assist with delivery planning, deadline reminders, acceptance checks and documentation.

Scope changes must be recorded as change orders and approved by both parties.

# 12. FINANCE AND EARNINGS

Create a complete financial workspace.

FREELANCER FINANCE:
- Total earnings.
- Available balance.
- Pending payments.
- Completed transactions.
- Invoices.
- Payout history.
- Transaction fees.
- Earnings charts.
- Monthly reports.
- Tax-related records.

CLIENT FINANCE:
- Total spending.
- Active project commitments.
- Outstanding invoices.
- Payment history.
- Project-wise expenses.
- Downloadable invoices.
- Payment status.

PLATFORM FINANCE:
- Gross native work value.
- Platform revenue.
- Fee breakdown.
- Payment processing costs.
- Refunds.
- Payout liabilities.
- Reconciliation.
- Transaction ledger.

The preferred flow is:

Work approved → Client pays → Platform deducts disclosed fees → Freelancer receives the remaining balance.

Never pretend that payments, escrow or payouts exist until the actual provider integration is implemented and verified.

# 13. ANALYTICS AND BUSINESS INTELLIGENCE

Provide separate analytical experiences.

Freelancer analytics:
- Application conversion.
- Proposal success rate.
- Earnings trends.
- Average project value.
- Client acquisition sources.
- Time spent.
- Pricing performance.
- Repeat client rate.
- Cash-flow forecasting.

Client analytics:
- Project spending.
- Hiring conversion.
- Freelancer performance.
- Delivery timelines.
- Project outcomes.
- Repeat hiring.

Platform analytics:
- Registrations.
- Active freelancers.
- Active clients.
- Native and external opportunities.
- Project-to-hire conversion.
- Collected transaction value.
- Platform revenue.
- Dispute rates.
- AI cost per completed project.
- Retention and growth.

Use real database-backed data. Never display fabricated statistics.

# 14. ADMINISTRATION AND PLATFORM OPERATIONS

Build a separate protected admin environment.

Sections:
- Platform Overview.
- User Management.
- Freelancer Verification.
- Client Verification.
- Project Moderation.
- External Source Management.
- Opportunity Freshness.
- AI Agent Monitoring.
- AI Usage and Costs.
- Payments and Reconciliation.
- Payout Exceptions.
- Refunds and Disputes.
- Support Tickets.
- Reports and Appeals.
- Audit Logs.
- Feature Flags.
- Platform Fee Configuration.
- System Health.

Provide detailed evidence and activity history for administrative actions.

Administrative permissions must be role-based.

# 15. DESIGN SYSTEM AND VISUAL EXPERIENCE

The overall visual direction should be premium, clean, modern, trustworthy and productivity-oriented.

Recommended direction:
- Light-first SaaS interface.
- Deep navy or charcoal typography.
- White and subtle neutral backgrounds.
- A restrained indigo/blue primary accent.
- Green for successful states.
- Amber for warnings.
- Red for errors and critical issues.
- Consistent spacing and typography.
- Refined borders and subtle shadows.
- Professional charts and tables.
- Clear icons.
- High-quality empty states.
- Consistent button hierarchy.
- Subtle transitions and meaningful micro-interactions.

Avoid:
- Excessive gradients.
- Overloaded dashboards.
- Too many colourful cards.
- Giant headings everywhere.
- Generic AI-generated landing page designs.
- Decorative AI animations that do not serve a purpose.
- Unnecessary modals.
- Fake statistics.
- Inconsistent component styles.

Use reusable components and design tokens.

Desktop should feel like a professional SaaS workspace. Mobile should feel like a polished mobile-first marketplace.

# 16. MOBILE-FIRST EXPERIENCE

The platform must work exceptionally well on mobile browsers.

Prioritise:
- Opportunity discovery.
- Freelancer profiles.
- Proposal editing.
- Client project posting.
- Inbox.
- Project review.
- Deliverable approval.
- Payment.
- Notifications.
- AI agent interactions.

Use responsive navigation, compact cards, readable tables, touch-friendly controls and low-bandwidth-friendly uploads.

A native mobile application is not required for the initial release.

# 17. COMPLETE USER JOURNEYS

Implement the following end-to-end journeys.

JOURNEY A — FREELANCER:
Registration → Profile creation → Portfolio upload → Opportunity discovery → AI analysis → Proposal drafting → Human approval → Application tracking → Client discussion → Offer → Contract → Delivery → Revision → Acceptance → Payment → Payout → Review.

JOURNEY B — CLIENT:
Registration → Business profile → Project creation → AI brief assistance → Publish → Freelancer matching → Proposal comparison → Shortlist → Discussion → Offer → Agreement → Project management → Delivery review → Acceptance → Payment → Review → Rehire.

JOURNEY C — AI ASSISTED FREELANCING:
User request → Context retrieval → Specialist agent selection → Task execution → Evidence validation → Output generation → Human approval → Action execution where permitted → Audit record.

JOURNEY D — PLATFORM OPERATIONS:
Opportunity ingestion → Validation → Deduplication → Classification → Publication → Matching → Trust checks → Transaction monitoring → Support → Dispute handling → Analytics.

# 18. AI GOVERNANCE — NON-NEGOTIABLE

Implement five autonomy levels:

A0: Observe and report.

A1: Suggest and recommend.

A2: Prepare editable drafts.

A3: Perform low-risk, reversible actions with explicit user opt-in.

A4: Consequential execution is reserved for humans.

Agents must never autonomously:
- Accept contracts.
- Approve milestones.
- Initiate payments.
- Issue refunds.
- Change payout destinations.
- Make binding scope changes.
- Suspend accounts.

Use evidence-grounded responses, authorised data access, audit logs, cost limits, approval records and prompt-injection protection.

# 19. FUNCTIONAL QUALITY EXPECTATIONS

Every screen must connect to real functionality.

Do not create buttons that only look functional.

Every action must have:
- A defined purpose.
- Correct permissions.
- Validation.
- Loading state.
- Success state.
- Error handling.
- Database persistence where applicable.
- Appropriate notifications.
- Audit events for consequential actions.

Ensure:
- No broken navigation.
- No dead buttons.
- No fabricated dashboard metrics.
- No duplicate project records.
- No cross-user data leakage.
- No incorrect application statuses.
- No payment status assumptions.
- No inaccessible mobile layouts.
- No inconsistent frontend and backend state.

# 20. IMPLEMENTATION INSTRUCTION

Treat this specification as the intended complete product experience.

Important implementation constraints:

1. Preserve the existing Freelance Income AI project.
2. Do not rebuild the application from scratch.
3. Do not delete existing working functionality.
4. Preserve the two-repository architecture:
   - freelance-income-ai: frontend.
   - freelance-income-ai-api-edge: edge API.
5. Preserve the current Cloudflare Workers and Neon PostgreSQL deployment direction.
6. Reuse existing APIs, database models, agent workflows, RAG, integrations and reusable UI components wherever possible.
7. Identify missing functionality before implementing it.
8. Connect frontend experiences to actual backend capabilities.
9. Add database migrations only when necessary and review their compatibility.
10. Prioritise complete end-to-end user journeys over adding disconnected features.
11. Make the experience production-oriented, secure, responsive, accessible and scalable.
12. Maintain compatibility with existing deployments and environment configuration.

## FINAL PRODUCT STANDARD

When a new user visits Freelance Income AI, they should immediately understand that it is a place to find freelance work, hire professional talent and manage freelance projects.

When a freelancer logs in, they should feel that they have an intelligent business assistant helping them discover opportunities, win projects, manage clients and grow income.

When a client logs in, they should feel that they have a complete hiring and project management system helping them find the right talent and achieve their business goals.

When users interact with AI, they should experience specialised agents that understand their context, use real evidence, complete useful preparation work and respect human approval.

The ultimate objective is one connected AI-powered freelance business ecosystem — not a collection of unrelated tools or dashboards.