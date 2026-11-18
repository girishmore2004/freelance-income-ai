'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { PublicNav } from '../public-nav';

/**
 * Contact (spec §2): messages go to staff as support tickets (/admin).
 * Visitors leave an email to reply to; signed-in users get the answer in
 * their notifications and see their messages here. The hidden "website"
 * field catches bots.
 */

const TOPICS: Array<[string, string]> = [
  ['account', 'My account or sign-in'], ['project', 'A project, proposal or contract'], ['payments', 'Payments and fees'],
  ['safety', 'Safety or a report'], ['business', 'Business or partnership'], ['other', 'Something else'],
];
type Ticket = { id: string; topic: string; subject: string; status: string; resolution_note: string; created_at: string };

export default function ContactPage() {
  const [token] = useSessionToken();
  const [topic, setTopic] = useState('account');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Ticket[]>([]);

  useEffect(() => {
    if (!token) return;
    api<Ticket[]>('/api/v1/me/support/tickets').then((t) => setMine(Array.isArray(t) ? t : [])).catch(() => setMine([]));
  }, [token, sent]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api('/api/v1/support/tickets', 'POST', { topic, subject, body: message, email, name, website });
      setSent('Thank you. Staff will reply as soon as they can.');
      setSubject('');
      setMessage('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_TICKET') {
        const d = err.details[0];
        setErrors(d && typeof d === 'object' ? (d as Record<string, string>) : {});
        setError('Check the highlighted fields.');
      } else setError(err instanceof Error ? err.message : 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (k: string) => (errors[k] ? <p className="error">{errors[k]}</p> : null);
  return (
    <main className="shell">
      {!token && <PublicNav />}
      <h1>Contact us</h1>
      <p className="muted">For questions about an account, a project or a payment. To report a project or a person, the Report link next to it is fastest.</p>
      {sent ? <p className="success" role="status">{sent}</p> : (
        <form className="card" onSubmit={(e) => void submit(e)} noValidate aria-label="Contact form">
          <div className="field"><label htmlFor="c-topic">What is it about?</label>
            <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{fieldError('topic')}
          </div>
          {!token && (
            <div className="row">
              <div className="field"><label htmlFor="c-email">Your email (we reply here)</label><input id="c-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />{fieldError('email')}</div>
              <div className="field"><label htmlFor="c-name">Your name (optional)</label><input id="c-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></div>
            </div>
          )}
          <div className="field"><label htmlFor="c-subject">Subject</label><input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />{fieldError('subject')}</div>
          <div className="field"><label htmlFor="c-body">Message (20–5,000 characters)</label><textarea id="c-body" rows={6} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />{fieldError('body')}</div>
          <div className="sr-only" aria-hidden="true"><label htmlFor="c-website">Leave this empty</label><input id="c-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
          <p className="muted small">Never send passwords or card numbers. Staff will never ask for them.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
        </form>
      )}
      {token && mine.length > 0 && (
        <section className="card" aria-labelledby="mine-heading">
          <h2 id="mine-heading">Your messages</h2>
          <ul>{mine.map((t) => <li key={t.id}><b>{t.subject}</b> · {t.status === 'resolved' ? 'Answered' : 'Waiting for staff'} · {new Date(t.created_at).toLocaleDateString()}{t.resolution_note ? <p className="muted">{t.resolution_note}</p> : null}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
