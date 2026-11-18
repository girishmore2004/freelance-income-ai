'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';
import { formatMinutes, parseDuration } from '@/lib/hours';

/**
 * Hours on an hourly contract (U19). The freelancer logs time for this week or
 * last week and submits the week; the client approves it (or returns it with a
 * note) and pays it. Amounts are minutes × the agreed rate, computed by the
 * server. Payments are test-mode until live payments open.
 */

type Entry = { id: string; work_date: string; minutes: number; description: string };
type Payment = { id: string; status: string; amount_minor: number; client_fee_minor: number; freelancer_fee_minor: number; total_minor: number; mode: string };
type Week = {
  id: string; week_start: string; status: 'open' | 'submitted' | 'approved' | 'paid'; minutes: number; rate_minor: number; amount_minor: number; amount_final: boolean;
  client_note: string; entries: Entry[]; payment: Payment | null;
};
type Hours = {
  billing: { hourly_rate_minor: number; weekly_limit_hours: number }; party: 'client' | 'freelancer'; can_log: boolean; can_decide: boolean; can_end: boolean;
  contract_status: string; this_week: string; limit_minutes: number; this_week_minutes: number; weeks: Week[]; note: string;
};

const STATUS: Record<Week['status'], string> = { open: 'Open', submitted: 'Waiting for approval', approved: 'Approved — to pay', paid: 'Paid' };
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const today = () => new Date().toISOString().slice(0, 10);

export function HoursPanel({ contractId, onEnded }: { contractId: string; onEnded: () => void }) {
  const [data, setData] = useState<Hours | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [duration, setDuration] = useState('');
  const [what, setWhat] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await api<Hours>(`/api/v1/contracts/${contractId}/timesheets`));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [contractId]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function log(e: FormEvent) {
    e.preventDefault();
    const minutes = parseDuration(duration);
    setFieldErrors({});
    if (minutes === null) { setFieldErrors({ minutes: 'Enter time like 1:30, 1.5 or 90m.' }); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/contracts/${contractId}/time-entries`, 'POST', { work_date: date, minutes, description: what });
      setDuration('');
      setWhat('');
      setNotice('Time logged.');
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.details[0] && typeof err.details[0] === 'object') setFieldErrors(err.details[0] as Record<string, string>);
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading hours…</p>;
  const left = Math.max(0, data.limit_minutes - data.this_week_minutes);

  return (
    <section aria-label="Hours">
      <p className="muted">
        {formatMinor(data.billing.hourly_rate_minor, 'INR')} an hour · up to {data.billing.weekly_limit_hours} hours a week
        {data.contract_status === 'active' && <> · this week: {formatMinutes(data.this_week_minutes)} logged, {formatMinutes(left)} left</>}
      </p>
      <p className="badge">TEST MODE — no real money moves</p>
      <div aria-live="polite">{notice && <p className="success" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>

      {data.can_log && (
        <form className="card" aria-label="Log time" onSubmit={log}>
          <h4>Log time</h4>
          <div className="row">
            <div className="field"><label htmlFor="h-date">Date</label><input id="h-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />{fieldErrors.work_date && <span className="error small">{fieldErrors.work_date}</span>}</div>
            <div className="field"><label htmlFor="h-dur">Time spent</label><input id="h-dur" placeholder="1:30" value={duration} onChange={(e) => setDuration(e.target.value)} />{fieldErrors.minutes && <span className="error small">{fieldErrors.minutes}</span>}</div>
          </div>
          <div className="field"><label htmlFor="h-what">What you did</label><input id="h-what" maxLength={500} value={what} onChange={(e) => setWhat(e.target.value)} />{fieldErrors.description && <span className="error small">{fieldErrors.description}</span>}</div>
          <button className="btn primary" type="submit" disabled={busy}>Add time</button>
          <p className="muted small">This week or last week only. Submit the week when it is done; the client approves and pays it.</p>
        </form>
      )}

      {data.weeks.length === 0 && <p className="empty">No hours logged yet.</p>}
      <ul>
        {data.weeks.map((w) => (
          <li key={w.id} className="card item" aria-label={`Week of ${w.week_start}`}>
            <div className="row between">
              <b>Week of {w.week_start}</b>
              <span className="badge">{STATUS[w.status]}</span>
            </div>
            <p className="muted">{formatMinutes(w.minutes)} × {formatMinor(w.rate_minor, 'INR')}/h = <b>{formatMinor(w.amount_minor, 'INR')}</b>{w.payment && w.payment.status === 'released' && <> · client paid {formatMinor(w.payment.total_minor, 'INR')} incl. fee · freelancer received {formatMinor(w.payment.amount_minor - w.payment.freelancer_fee_minor, 'INR')}</>}</p>
            {w.client_note && w.status === 'open' && <p className="notice">Returned by the client: {w.client_note}</p>}
            <table>
              <caption className="sr-only">Time entries for the week of {w.week_start}</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Work</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {w.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.work_date}</td><td>{formatMinutes(e.minutes)}</td><td>{e.description}</td>
                    <td>{data.party === 'freelancer' && w.status === 'open' && data.contract_status === 'active' && (
                      <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/time-entries/${e.id}/delete`, 'POST', {}), 'Time entry removed.')}>Remove</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              {data.party === 'freelancer' && w.status === 'open' && w.minutes > 0 && (
                <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/timesheets/${w.id}/submit`, 'POST', {}), 'Submitted for the client’s approval.')}>Submit week of {w.week_start}</button>
              )}
              {data.can_decide && w.status === 'submitted' && (
                <>
                  <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/timesheets/${w.id}/review`, 'POST', { decision: 'approve' }), 'Approved. Pay it when you are ready.')}>Approve week of {w.week_start}</button>
                  <label className="sr-only" htmlFor={`ret-${w.id}`}>What should the freelancer correct?</label>
                  <input id={`ret-${w.id}`} placeholder="What to correct (to return)" maxLength={1000} value={notes[w.id] ?? ''} onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })} />
                  <button className="btn" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/timesheets/${w.id}/review`, 'POST', { decision: 'return', note: notes[w.id] ?? '' }), 'Returned to the freelancer.')}>Return week of {w.week_start}</button>
                </>
              )}
              {data.can_decide && w.status === 'approved' && (
                w.payment?.status === 'created' ? (
                  <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/payments/sandbox/${w.payment!.id}/complete`, 'POST', { outcome: 'succeed' }), 'Paid. The freelancer received the payment.')}>Complete test payment of {formatMinor(w.payment.total_minor, 'INR')}</button>
                ) : (
                  <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/timesheets/${w.id}/pay`, 'POST', { idempotency_key: `ts-${w.id}-${Date.now()}` }), 'Checkout created. Complete the test payment.')}>Pay week of {w.week_start}</button>
                )
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.can_end && (
        <div className="card">
          <p className="muted">Ending the contract stops new hours. Submitted weeks can still be approved and paid, and both of you can leave a review.</p>
          <button className="btn" type="button" disabled={busy} onClick={() => void run(async () => { await api(`/api/v1/contracts/${contractId}/end`, 'POST', {}); onEnded(); }, 'Contract ended.')}>End contract</button>
        </div>
      )}
      <p className="muted small">{data.note}</p>
    </section>
  );
}
