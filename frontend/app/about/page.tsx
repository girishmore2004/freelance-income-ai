import { PublicNav } from '../public-nav';

export const metadata = { title: 'About · Freelance Income AI', description: 'What Freelance Income AI is, how its AI agents work, and what it does not do.' };

export default function AboutPage() {
  return (
    <main className="shell">
      <PublicNav />
      <h1>About Freelance Income AI</h1>
      <p className="lead">A freelance marketplace where specialised AI agents do the preparation — finding matching work, drafting proposals and briefs, comparing candidates, checking deliveries — and people make every decision.</p>
      <section className="card">
        <h2>What we believe</h2>
        <ul>
          <li><b>People decide.</b> Agents never accept contracts, approve work, move money or suspend accounts. Every send, offer and payment needs a person.</li>
          <li><b>Evidence over claims.</b> Proposals can cite only the portfolio a freelancer has on their profile, and the platform flags claims it cannot check.</li>
          <li><b>Clear money.</b> Fees are shown before you commit. Payments run in test mode until the payment provider and legal setup are approved.</li>
          <li><b>Real numbers only.</b> Counts and analytics come from records on the platform, with small samples marked; nothing is invented.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Where things stand</h2>
        <p>The marketplace — posting, matching, proposals, contracts, delivery, reviews and disputes — is built and being tested before launch. Live payments, email delivery and the legal documents (terms, privacy, refunds) are waiting for the company and provider setup and are not available yet.</p>
      </section>
      <p><a className="btn primary" href="/how-it-works">How it works</a> <a className="btn" href="/contact">Contact us</a></p>
    </main>
  );
}
