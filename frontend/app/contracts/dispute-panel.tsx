'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

/**
 * Disputes on a contract. Either side (client owners/admins, or the
 * freelancer) can open one while the contract is active. Both sides add
 * statements; staff review the platform record and decide. Only an admin can
 * decide an outcome that moves money.
 */

type Statement = { id: string; party: string; body: string; created_at: string };
type Dispute = {
  id: string; opened_by: string; mine: boolean; reason: string; description: string; desired_outcome: string; status: string;
  resolution: string | null; resolution_note: string; resolved_at: string | null; created_at: string; statements: Statement[];
};
type DisputeView = { dispute: Dispute | null; can_open: boolean };

export const DISPUTE_REASONS: Array<[string, string]> = [
  ['quality', 'Work quality'], ['non_delivery', 'Work not delivered'], ['scope', 'Scope disagreement'],
  ['payment', 'Payment'], ['communication', 'Communication'], ['other', 'Other'],
];
const REASON_LABEL = Object.fromEntries(DISPUTE_REASONS);
export const RESOLUTION_LABELS: Record<string, string> = {
  release_funded: 'Funded milestones released to the freelancer; contract completed',
  refund_funded: 'Funded milestones refunded to the client; contract cancelled',
  no_action: 'No money moved; the contract continues',
};
const STATUS_LABEL: Record<string, string> = { open: 'Open: waiting for staff', resolved: 'Decided', withdrawn: 'Withdrawn' };

export function DisputePanel({ contractId, canManage, onChanged }: { contractId: string; canManage: boolean; onChanged: () => void }) {
  const [view, setView] = useState<DisputeView | null>(null);
  const [opening, setOpening] = useState(false);
  const [reason, setReason] = useState('quality');
  const [description, setDescription] = useState('');
  const [desired, setDesired] = useState('');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<DisputeView>(`/api/v1/contracts/${contractId}/dispute`);
      setView(result && typeof result.can_open === 'boolean' ? result : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the dispute.');
    }
  }, [contractId]);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<{ message?: string } | unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(done);
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function open(event: FormEvent) {
    event.preventDefault();
    const ok = await run(() => api(`/api/v1/contracts/${contractId}/dispute`, 'POST', { reason, description, desired_outcome: desired }), 'Dispute opened. Staff will review the contract record and both statements.');
    if (ok) { setOpening(false); setDescription(''); setDesired(''); }
  }

  async function addStatement(event: FormEvent) {
    event.preventDefault();
    if (!view?.dispute) return;
    const ok = await run(() => api(`/api/v1/disputes/${view.dispute!.id}/statements`, 'POST', { body: statement }), 'Statement added');
    if (ok) setStatement('');
  }

  if (!view) return error ? <p className="error" role="alert">{error}</p> : null;
  const d = view.dispute;
  if (!d && !view.can_open) return null;

  return (
    <section className="card" aria-label="Dispute">
      <b>Dispute</b>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {d && (
        <div>
          <p>
            <span className="badge">{STATUS_LABEL[d.status] ?? d.status}</span>{' '}
            {REASON_LABEL[d.reason] ?? d.reason} · opened by {d.mine ? 'you' : `the ${d.opened_by}`} on {new Date(d.created_at).toLocaleDateString()}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>
          {d.desired_outcome && <p className="muted">Outcome asked for: {d.desired_outcome}</p>}
          {d.status === 'resolved' && d.resolution && (
            <div className="item">
              <b>Decision: {RESOLUTION_LABELS[d.resolution] ?? d.resolution}</b>
              <p style={{ whiteSpace: 'pre-wrap' }}>{d.resolution_note}</p>
            </div>
          )}
          {d.statements.length > 0 && (
            <ul aria-label="Statements">
              {d.statements.map((s) => <li key={s.id}><b>{s.party === 'client' ? 'Client' : 'Freelancer'}:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{s.body}</span> <span className="muted">{new Date(s.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></li>)}
            </ul>
          )}
          {d.status === 'open' && canManage && (
            <form onSubmit={(e) => void addStatement(e)}>
              <div className="field">
                <label htmlFor={`stmt-${d.id}`}>Add a statement or evidence note</label>
                <textarea id={`stmt-${d.id}`} rows={3} maxLength={4000} value={statement} onChange={(e) => setStatement(e.target.value)} />
              </div>
              <div className="row">
                <button className="btn" type="submit" disabled={busy || statement.trim().length < 5}>Add statement</button>
                {d.mine && <button className="btn" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/disputes/${d.id}/withdraw`, 'POST', {}), 'Dispute withdrawn')}>Withdraw dispute</button>}
              </div>
            </form>
          )}
        </div>
      )}
      {view.can_open && !opening && (
        <div>
          <p className="muted">If you cannot agree with the other side, staff can review the contract record (terms, deliveries, messages, payments) and decide.</p>
          <button className="btn" type="button" onClick={() => setOpening(true)}>Raise a dispute</button>
        </div>
      )}
      {view.can_open && opening && (
        <form onSubmit={(e) => void open(e)}>
          <div className="field">
            <label htmlFor={`dreason-${contractId}`}>What is it about?</label>
            <select id={`dreason-${contractId}`} value={reason} onChange={(e) => setReason(e.target.value)}>
              {DISPUTE_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`ddesc-${contractId}`}>What happened? (at least 30 characters)</label>
            <textarea id={`ddesc-${contractId}`} rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`ddes-${contractId}`}>What outcome do you want? (optional)</label>
            <input id={`ddes-${contractId}`} maxLength={1000} value={desired} onChange={(e) => setDesired(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || description.trim().length < 30}>Open dispute</button>
            <button className="btn" type="button" onClick={() => setOpening(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
