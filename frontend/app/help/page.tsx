import { PublicNav } from '../public-nav';

export const metadata = { title: 'Help · Freelance Income AI', description: 'Answers to common questions about Freelance Income AI.' };

const FAQ: Array<[string, string]> = [
  ['Can one account both find work and hire?', 'Yes. Choose “Both” when you sign up, or later use “+ Client” or “+ Freelancer” in the top bar. Your freelancer and client records stay separate.'],
  ['Does the AI send anything for me?', 'No. AI drafts proposals, briefs and checklists. You review and approve before anything is sent, published or accepted.'],
  ['What happens when I reach my AI limit?', 'Proposals and briefs are drafted from templates instead. Your plan and usage are on the Account page.'],
  ['How does a contract become active?', 'The client sends an offer. It becomes active only when both of you accept the same version of the terms. Either side can propose changes; each change is a new version.'],
  ['Can terms change after work starts?', 'Yes, with a change order that both sides accept. Delivered milestones cannot be rewritten.'],
  ['How are payments handled?', 'Payments through the platform are not live yet. The platform records agreements, deliveries and approvals, but does not hold or move money.'],
  ['Who can see my reviews?', 'Reviews are shown once both sides have reviewed, or 14 days after the contract is completed.'],
  ['How do I report something?', 'Use the Report link on a project. Staff review every report.'],
];

export default function HelpPage() {
  return (
    <main className="shell">
      <PublicNav />
      <h1>Help</h1>
      {FAQ.map(([q, a]) => (
        <details className="card" key={q}>
          <summary><b>{q}</b></summary>
          <p>{a}</p>
        </details>
      ))}
    </main>
  );
}
