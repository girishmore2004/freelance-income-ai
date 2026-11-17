import { PublicNav } from '../public-nav';

export const metadata = { title: 'How it works · Freelance Income AI', description: 'How freelancers and clients work together on Freelance Income AI, with AI that drafts and explains while people decide.' };

export default function HowItWorksPage() {
  return (
    <main className="shell">
      <PublicNav />
      <h1>How it works</h1>
      <p>Freelance Income AI connects freelancers and clients. AI agents find, explain and draft; people approve everything that is sent, published, accepted or paid.</p>

      <section className="card" aria-labelledby="freelancers">
        <h2 id="freelancers">For freelancers</h2>
        <ol>
          <li><b>Find work.</b> The Opportunity Scout gathers projects from permitted sources and from clients on the platform, with a transparent fit score.</li>
          <li><b>Draft proposals.</b> The Proposal Agent drafts from your confirmed profile. You edit and approve before anything is sent.</li>
          <li><b>Get invited.</b> Choose to be visible to clients. They see your name, headline, skills and rate — never your email or links.</li>
          <li><b>Agree terms.</b> Offers become contracts only when you and the client accept the same version of the terms.</li>
          <li><b>Deliver.</b> Submit each milestone with notes and links; the client approves or asks for a revision within the agreed rounds.</li>
          <li><b>Build reputation.</b> After completion both sides review each other; reviews appear once both are in.</li>
        </ol>
      </section>

      <section className="card" aria-labelledby="clients">
        <h2 id="clients">For clients</h2>
        <ol>
          <li><b>Describe the work.</b> The Brief Builder turns your notes into a structured brief. You set the budget and dates; it never does.</li>
          <li><b>Publish.</b> Briefs are screened for scams and off-platform requests before they go live.</li>
          <li><b>Find freelancers.</b> Suggested freelancers come with plain reasons for each score, and new freelancers get a fair place.</li>
          <li><b>Compare and hire.</b> Proposals are compared side by side — facts and flags, never a ranking by price.</li>
          <li><b>Review delivery.</b> Each delivery comes with a checklist against your acceptance criteria. You decide.</li>
        </ol>
      </section>

      <section className="card" aria-labelledby="ai">
        <h2 id="ai">What the AI will and will not do</h2>
        <ul>
          <li>It drafts, explains and checks. It never sends, publishes, accepts, approves or pays on its own.</li>
          <li>It never decides prices or amounts. Money values are typed by people and checked by fixed rules.</li>
          <li>Every agent has a stated autonomy limit and a human approval step. See the full list on the AI agents page after signing in.</li>
        </ul>
      </section>
      <p className="muted">Payments through the platform are not live yet. Until they are, the platform records agreements and approvals but does not move money.</p>
    </main>
  );
}
