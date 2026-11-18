'use client';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, ApiError, api, authFetch } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/**
 * Monthly statement (U13): freelancers see released milestones, fees and
 * withdrawals; client owners/admins see funding, fees and refunds. Test-mode
 * money is labelled and totalled apart from live money. CSV download for records.
 */

type Line = { date: string; kind: string; mode: string; contract: string; milestone: number | null; gross_minor: number; fee_minor: number; net_minor: number; currency: string };
type Total = { mode: string; currency: string; gross_minor: number; fee_minor: number; net_minor: number; payouts_minor: number; refunds_minor: number };
type Statement = { month: string; side: 'freelancer' | 'client'; lines: Line[]; totals: Total[]; note: string };
type Account = { id: string; name: string };

const KIND: Record<string, string> = { release: 'Released to you', payout: 'Withdrawn', funding: 'Funded', refund: 'Refunded' };

function lastMonths(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

export function StatementPanel({ accounts, initialSide }: { accounts: Account[]; initialSide: string }) {
  const months = lastMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [side, setSide] = useState(initialSide);
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const query = `month=${month}${side === 'freelancer' ? '' : `&organization_id=${encodeURIComponent(side)}`}`;

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api<Statement>(`/api/v1/me/statements?${query}`);
      setData(r && Array.isArray(r.lines) ? r : null);
    } catch (e) {
      setData(null);
      if (!(e instanceof ApiError && e.code === 'FEATURE_DISABLED')) setError(e instanceof Error ? e.message : 'Could not load the statement.');
    }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  async function download() {
    try {
      const response = await authFetch(`${API_BASE}/api/v1/me/statements?${query}&format=csv`);
      if (!response.ok) throw new Error('Could not download the statement.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${month}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the statement.');
    }
  }

  return (
    <section className="card" aria-labelledby="statement-heading">
      <h3 id="statement-heading">Monthly statement</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="st-month">Month</label>
          <select id="st-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</option>)}
          </select>
        </div>
        {/* One side at a time: the freelancer statement on the freelancer side, client accounts on the client side. */}
        {initialSide !== 'freelancer' && accounts.length > 1 && (
          <div className="field">
            <label htmlFor="st-side">Client account</label>
            <select id="st-side" value={side} onChange={(e) => setSide(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <button className="btn" type="button" onClick={() => void download()} disabled={!data || data.lines.length === 0}>Download CSV</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <>
          {data.totals.length === 0 && <p className="empty">No money moved in this month.</p>}
          {data.totals.map((t) => (
            <p key={`${t.mode}-${t.currency}`} className={t.mode === 'sandbox' ? 'muted' : ''}>
              <span className="badge">{t.mode === 'sandbox' ? 'TEST MODE' : 'Live'}</span>{' '}
              {data.side === 'freelancer'
                ? <>Earned {formatMinor(t.net_minor, t.currency)} after {formatMinor(t.fee_minor, t.currency)} fees (gross {formatMinor(t.gross_minor, t.currency)}) · withdrawn {formatMinor(t.payouts_minor, t.currency)}</>
                : <>Paid {formatMinor(t.net_minor, t.currency)} including {formatMinor(t.fee_minor, t.currency)} fees · refunded {formatMinor(t.refunds_minor, t.currency)}</>}
            </p>
          ))}
          {data.lines.length > 0 && (
            <table>
              <caption className="sr-only">Statement lines</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Contract</th><th scope="col">Amount</th><th scope="col">Fee</th><th scope="col">Net</th></tr></thead>
              <tbody>{data.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.date}</td>
                  <td>{KIND[l.kind] ?? l.kind}{l.mode === 'sandbox' ? ' (test)' : ''}</td>
                  <td>{l.contract}{l.milestone !== null ? ` · milestone ${l.milestone + 1}` : ''}</td>
                  <td>{formatMinor(l.gross_minor, l.currency)}</td>
                  <td>{l.fee_minor ? formatMinor(l.fee_minor, l.currency) : '—'}</td>
                  <td>{formatMinor(l.net_minor, l.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="muted small">{data.note}</p>
        </>
      )}
    </section>
  );
}
