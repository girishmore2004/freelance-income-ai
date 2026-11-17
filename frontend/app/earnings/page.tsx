'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatMinor, rupeesToMinor } from '@/lib/listing-format';

/** Freelancer earnings: released balance, funds held for approved work in progress, payouts. */

type Release = { id: string; contract_id: string; milestone_index: number; status: string; net_minor: number; released_at: string | null; funded_at: string | null };
type Payout = { id: string; amount_minor: number; status: string; created_at: string };
type Earnings = { payments_enabled: boolean; mode: string; note: string; available_minor: number; in_escrow_minor: number; releases: Release[]; payouts: Payout[] };

export default function EarningsPage() {
  const [token] = useSessionToken();
  const [data, setData] = useState<Earnings | null>(null);
  const [amount, setAmount] = useState('');
  const [payoutKey, setPayoutKey] = useState(() => crypto.randomUUID());
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<Earnings>('/api/v1/me/earnings');
      if (result && typeof result.available_minor === 'number') setData(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') setClosed(true);
      else setError(e instanceof Error ? e.message : 'Could not load earnings.');
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    const minor = rupeesToMinor(amount);
    if (minor === null || Number.isNaN(minor)) { setError('Enter an amount in rupees.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ message?: string }>('/api/v1/me/payouts', 'POST', { amount_minor: minor, idempotency_key: payoutKey });
      setNotice(result.message ?? 'Payout requested');
      setAmount('');
      setPayoutKey(crypto.randomUUID());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request the payout.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <main className="shell"><div className="card"><h2>Earnings</h2><p className="muted">Sign in first to see your earnings.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  return (
    <main className="shell">
      <div className="row between"><h2>Earnings</h2><a className="link" href="/contracts">Contracts</a></div>
      {closed && <div className="card"><p className="muted">Earnings open with the client marketplace.</p></div>}
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {data && (
        <>
          {data.mode === 'sandbox' && data.payments_enabled && <p className="badge">TEST MODE — no real money moves</p>}
          {data.note && <p className="muted">{data.note}</p>}
          <section className="card" aria-labelledby="balance-heading">
            <h3 id="balance-heading">Balance</h3>
            <p><b>{formatMinor(data.available_minor, 'INR')}</b> available to withdraw</p>
            <p className="muted">{formatMinor(data.in_escrow_minor, 'INR')} funded by clients for milestones not yet approved (after fees).</p>
            {data.payments_enabled && data.available_minor > 0 && (
              <form className="row" onSubmit={(e) => void withdraw(e)}>
                <div className="field"><label htmlFor="payout-amount">Withdraw (₹)</label><input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <button className="btn primary" type="submit" disabled={busy}>Withdraw</button>
              </form>
            )}
          </section>
          <section className="card" aria-labelledby="releases-heading">
            <h3 id="releases-heading">Milestone payments</h3>
            {data.releases.length === 0 ? <p className="empty">No funded milestones yet.</p> : (
              <ul>{data.releases.map((r) => <li key={r.id}>Milestone {r.milestone_index + 1} · {formatMinor(r.net_minor, 'INR')} · {r.status === 'released' ? `paid to you ${r.released_at ? new Date(r.released_at).toLocaleDateString() : ''}` : 'funded, waiting for approval'}</li>)}</ul>
            )}
          </section>
          <section className="card" aria-labelledby="payouts-heading">
            <h3 id="payouts-heading">Payouts</h3>
            {data.payouts.length === 0 ? <p className="empty">No payouts yet.</p> : (
              <ul>{data.payouts.map((p) => <li key={p.id}>{formatMinor(p.amount_minor, 'INR')} · {p.status} · {new Date(p.created_at).toLocaleDateString()}</li>)}</ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
