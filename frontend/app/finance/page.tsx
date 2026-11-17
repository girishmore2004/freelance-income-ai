'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';
import { AdminPlanTools } from './admin-plan-tools';
import { AdminPayments } from './admin-payments';

/**
 * Staff finance page (finance/admin roles only): fee schedules and the
 * sandbox trial balance. Approving a schedule is an admin decision (D-5).
 * Nothing on this page moves money.
 */

type Schedule = { id: string; name: string; currency: string; client_fee_bps: number; freelancer_fee_bps: number; min_fee_minor: number; status: string; approved_at: string | null; created_at: string };
type Row = { code: string; name: string; kind: string; currency: string; debit_minor: number; credit_minor: number; balance_minor: number };
type Balance = { mode: string; rows: Row[]; totals: Record<string, { debit_minor: number; credit_minor: number; balanced: boolean }> };

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default function FinancePage() {
  const [token] = useSessionToken();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [form, setForm] = useState({ name: '', client: '', freelancer: '', min: '0' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api<Schedule[]>('/api/v1/finance/fee-schedules'), api<Balance>('/api/v1/finance/trial-balance?mode=sandbox')]);
      setSchedules(Array.isArray(s) ? s : []);
      setBalance(b && Array.isArray(b.rows) ? b : null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setForbidden(true);
      else setError(e instanceof Error ? e.message : 'Could not load finance data.');
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const toBps = (v: string) => Math.round(Number(v) * 100);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/api/v1/finance/fee-schedules', 'POST', {
        name: form.name, currency: 'INR', client_fee_bps: toBps(form.client), freelancer_fee_bps: toBps(form.freelancer), min_fee_minor: Math.round(Number(form.min) * 100),
      });
      setNotice('Draft saved. An admin must approve it before it is used.');
      setForm({ name: '', client: '', freelancer: '', min: '0' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/finance/fee-schedules/${id}/approve`, 'POST');
      setNotice('Fee schedule approved. It now applies to new fee quotes.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <main className="shell"><div className="card"><h2>Finance</h2><p className="muted">Sign in first.</p><a className="btn" href="/">Go to sign in</a></div></main>;
  if (forbidden) return <main className="shell"><div className="card"><h2>Finance</h2><p className="muted">This page is for finance staff.</p><a className="btn" href="/">Back to workspace</a></div></main>;

  return (
    <main className="shell">
      <h2>Finance</h2>
      <p className="muted">Payments are not enabled. Fee schedules only affect fee estimates until payments are approved (D-1/D-2).</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>

      <section className="card" aria-labelledby="fees-heading">
        <h3 id="fees-heading">Fee schedules</h3>
        {schedules.length === 0 && <p className="empty">No fee schedule yet. Fees are founder decision D-5.</p>}
        <ul>
          {schedules.map((s) => (
            <li key={s.id}>
              <b>{s.name}</b> · client {pct(s.client_fee_bps)} · freelancer {pct(s.freelancer_fee_bps)} · minimum {formatMinor(s.min_fee_minor, s.currency)} · <span className="badge">{s.status}</span>
              {s.status === 'draft' && <> <button className="btn" disabled={busy} onClick={() => void approve(s.id)}>Approve (admin)</button></>}
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => void create(e)}>
          <div className="row">
            <div className="field"><label htmlFor="f-name">Name</label><input id="f-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="f-client">Client fee (%)</label><input id="f-client" inputMode="decimal" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></div>
            <div className="field"><label htmlFor="f-freelancer">Freelancer fee (%)</label><input id="f-freelancer" inputMode="decimal" value={form.freelancer} onChange={(e) => setForm({ ...form, freelancer: e.target.value })} /></div>
            <div className="field"><label htmlFor="f-min">Minimum fee (₹)</label><input id="f-min" inputMode="decimal" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></div>
          </div>
          <button className="btn primary" type="submit" disabled={busy}>Save draft</button>
        </form>
      </section>

      <AdminPayments />

      <AdminPlanTools />

      <section className="card" aria-labelledby="tb-heading">
        <h3 id="tb-heading">Sandbox trial balance</h3>
        {!balance || balance.rows.length === 0 ? <p className="empty">No sandbox entries.</p> : (
          <table>
            <thead><tr><th scope="col">Account</th><th scope="col">Kind</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Balance</th></tr></thead>
            <tbody>
              {balance.rows.map((r) => <tr key={`${r.code}-${r.currency}`}><td>{r.name} <span className="muted">{r.code}</span></td><td>{r.kind}</td><td>{formatMinor(r.debit_minor, r.currency)}</td><td>{formatMinor(r.credit_minor, r.currency)}</td><td>{formatMinor(r.balance_minor, r.currency)}</td></tr>)}
            </tbody>
          </table>
        )}
        {balance && Object.entries(balance.totals).map(([currency, t]) => <p key={currency} className={t.balanced ? 'success' : 'error'}>{currency}: debits {formatMinor(t.debit_minor, currency)} · credits {formatMinor(t.credit_minor, currency)} · {t.balanced ? 'balanced' : 'NOT balanced'}</p>)}
      </section>
    </main>
  );
}
