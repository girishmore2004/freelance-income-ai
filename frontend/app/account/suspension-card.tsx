'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

/**
 * Shown only when the account is suspended or a past suspension has a
 * decision to show. The person can read the reason and appeal once; a
 * different staff member decides the appeal.
 */

type Suspension = { id: string; reason: string; status: string; created_at: string; lifted_at: string | null; lift_note: string; appeal_text: string; appeal_status: string; appeal_at: string | null };
type Standing = { suspended: boolean; suspension: Suspension | null; can_appeal: boolean };

const APPEAL_LABEL: Record<string, string> = {
  pending: 'Your appeal is waiting for a staff member.',
  upheld: 'Your appeal was reviewed and the suspension stays.',
  overturned: 'Your appeal was accepted.',
};

export function SuspensionCard() {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<Standing>('/api/v1/me/suspension');
      setStanding(result && typeof result.suspended === 'boolean' ? result : null);
    } catch {
      setStanding(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function appeal(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/v1/me/suspension/appeal', 'POST', { text });
      setNotice('Appeal submitted. A staff member will review it and you will get a notification.');
      setText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the appeal.');
    } finally {
      setBusy(false);
    }
  }

  if (!standing?.suspended || !standing.suspension) return null;
  const s = standing.suspension;
  return (
    <section className="card" aria-labelledby="suspension-heading" role="region">
      <h3 id="suspension-heading">Your account is suspended</h3>
      <p>{s.reason}</p>
      <p className="muted">Since {new Date(s.created_at).toLocaleDateString()}. You can still sign in and see your contracts and payments, but you cannot send proposals, hire, message, fund or withdraw until the suspension is lifted.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {s.appeal_status !== 'none' && <p><b>{APPEAL_LABEL[s.appeal_status] ?? s.appeal_status}</b>{s.appeal_status === 'upheld' && s.lift_note ? ` ${s.lift_note}` : ''}</p>}
      {standing.can_appeal && (
        <form onSubmit={(e) => void appeal(e)}>
          <div className="field">
            <label htmlFor="appeal-text">Appeal: explain why the suspension should be lifted (at least 30 characters; you can appeal once)</label>
            <textarea id="appeal-text" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy || text.trim().length < 30}>Submit appeal</button>
        </form>
      )}
    </section>
  );
}
