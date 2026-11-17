import { PublicNav } from '../public-nav';

export const metadata = { title: 'Safety · Freelance Income AI', description: 'How Freelance Income AI keeps freelancers and clients safe.' };

export default function SafetyPage() {
  return (
    <main className="shell">
      <PublicNav />
      <h1>Safety</h1>
      <section className="card">
        <h2>Warning signs</h2>
        <ul>
          <li>Anyone asking you to pay a registration, joining or training fee to get work.</li>
          <li>Requests to move the conversation or payment to WhatsApp, Telegram, email or crypto.</li>
          <li>Work that breaks rules or laws: fake reviews, exam help, hacking, phishing.</li>
          <li>Short links that hide where they go.</li>
        </ul>
      </section>
      <section className="card">
        <h2>What the platform does</h2>
        <ul>
          <li>New project briefs are screened; suspicious ones wait for a human moderator before they are published.</li>
          <li>Messages, proposals and invitations that include phone numbers, emails or payment requests are refused.</li>
          <li>Freelancers choose whether clients can find them; contact details are never shown on profiles.</li>
          <li>Every moderation decision is recorded and cannot be edited afterwards.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Report a problem</h2>
        <p>Use the <b>Report</b> link on a project. Staff review every report. If you are in immediate danger, contact the local authorities.</p>
      </section>
    </main>
  );
}
