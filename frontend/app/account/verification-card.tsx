'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';

/**
 * Ask staff to review your public evidence (U10). Approval shows a
 * "Reviewed" badge to clients or freelancers. It is not an identity check and
 * the page says so.
 */

type Latest = { id: string; status: string; decision_note: string; created_at: string; decided_at: string | null } | null;
type Status = {
  available: boolean; meaning: string;
  freelancer: { verified_at: string | null; latest: Latest } | null;
  organizations: Array<{ id: string; name: string; can_request: boolean; verified_at: string | null; latest: Latest }>;
};

const STATUS_TEXT: Record<string, string> = { pending: 'Waiting for staff review', approved: 'Approved', rejected: 'Not approved', revoked: 'Badge removed' };

function Subject({ title, verifiedAt, latest, canRequest, onSubmit }: {
  title: string; verifiedAt: string | null; latest: Latest; canRequest: boolean; onSubmit: (links: string[], note: string, reg: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState('');
  const [note, setNote] = useState('');
  const [reg, setReg] = useState('');
  const id = title.replace(/\W+/g, '-').toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const list = links.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    if (await onSubmit(list, note, reg)) setOpen(false);
  }

  return (
    <div className="item">
      <b>{title}</b>{' '}
      {verifiedAt ? <span className="badge">Reviewed by staff on {verifiedAt.slice(0, 10)}</span>
        : latest ? <span className="badge">{STATUS_TEXT[latest.status] ?? latest.status}</span> : <span className="muted">Not reviewed</span>}
      {latest && ['rejected', 'revoked'].includes(latest.status) && latest.decision_note && <p className="muted">Staff note: {latest.decision_note}</p>}
      {!verifiedAt && latest?.status !== 'pending' && canRequest && !open && <div><button className="btn" type="button" onClick={() => setOpen(true)}>Ask for a review</button></div>}
      {open && (
        <form onSubmit={submit} aria-label={`Review request for ${title}`}>
          <div className="field">
            <label htmlFor={`links-${id}`}>Links to your work, profiles or business website (1–5, one per line)</label>
            <textarea id={`links-${id}`} rows={3} value={links} onChange={(e) => setLinks(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor={`reg-${id}`}>Business registration number (optional)</label>
            <input id={`reg-${id}`} maxLength={60} value={reg} onChange={(e) => setReg(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`note-${id}`}>Anything staff should know (optional)</label>
            <textarea id={`note-${id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row"><button className="btn primary" type="submit">Send for review</button><button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

/** Review requests for the active side only: the freelancer profile, or the client accounts. */
export function VerificationCard({ side }: { side: 'freelancer' | 'client' }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api<Status>('/api/v1/me/verification');
      setStatus(r && typeof r === 'object' && Array.isArray(r.organizations) ? r : null);
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function request(body: Record<string, unknown>): Promise<boolean> {
    setError('');
    setNotice('');
    try {
      await api('/api/v1/me/verification', 'POST', body);
      setNotice('Sent. Staff will review it and you will get a notification.');
      await load();
      return true;
    } catch (e) {
      const field = e instanceof ApiError && Array.isArray(e.details) && e.details[0] && typeof e.details[0] === 'object' ? Object.values(e.details[0] as Record<string, string>)[0] : '';
      setError(field || (e instanceof Error ? e.message : 'Could not send the request.'));
      return false;
    }
  }

  const showFreelancer = side === 'freelancer' && Boolean(status?.freelancer);
  const orgs = side === 'client' ? status?.organizations ?? [] : [];
  if (!status || !status.available || (!showFreelancer && orgs.length === 0)) return null;
  return (
    <section className="card" aria-labelledby="verify-heading">
      <h3 id="verify-heading">Account review</h3>
      <p className="muted">{status.meaning}</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {showFreelancer && status.freelancer && (
        <Subject title="Your freelancer profile" verifiedAt={status.freelancer.verified_at} latest={status.freelancer.latest} canRequest
          onSubmit={(links, note, reg) => request({ subject: 'freelancer', links, note, registration_number: reg })} />
      )}
      {orgs.map((o) => (
        <Subject key={o.id} title={`Client account: ${o.name}`} verifiedAt={o.verified_at} latest={o.latest} canRequest={o.can_request}
          onSubmit={(links, note, reg) => request({ subject: 'client', organization_id: o.id, links, note, registration_number: reg })} />
      ))}
    </section>
  );
}
