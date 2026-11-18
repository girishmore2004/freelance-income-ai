'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/**
 * Finance exceptions and reconciliation (spec §14): stale checkouts, failed
 * payments, approved milestones not released yet, payout problems, and a check
 * that funds held in the ledger match funded payments. Actions are logged.
 */

type Row = { id: string; contract_id?: string; milestone_index?: number; total_minor?: number; amount_minor?: number; currency: string; mode: string; status?: string; created_at?: string | null; updated_at?: string | null };
type Exceptions = {
  stale_checkouts: Row[]; failed_payments: Row[]; approved_not_released: Row[]; payout_exceptions: Row[];
  reconciliation: { held_mismatches: Array<{ contract_id: string; mode: string; ledger_held_minor: number; funded_intents_minor: number }>; trial_balance: { sandbox: boolean; live: boolean }; ok: boolean };
  definitions: Record<string, string>;
};

const amount = (r: Row) => formatMinor(Number(r.total_minor ?? r.amount_minor ?? 0), r.currency || 'INR');

export function FinanceExceptions() {
  const [data, setData] = useState<Exceptions | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Exceptions>('/api/v1/admin/finance-exceptions');
      if (r && r.reconciliation) setData(r);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) setError(e instanceof Error ? e.message : 'Could not load finance exceptions.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(path: string, body?: Record<string, string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<{ message?: string }>(path, 'POST', body ?? {});
      setNotice(r?.message ?? 'Done');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : null;
  const rec = data.reconciliation;
  return (
    <section className="card" aria-labelledby="fx-heading">
      <h3 id="fx-heading">Exceptions and reconciliation</h3>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      <p className={rec.ok ? 'success' : 'error'}>
        {rec.ok ? 'Reconciled: funds held in the ledger match funded payments, and both trial balances are balanced.' : 'Reconciliation needs attention.'}
      </p>
      {!rec.trial_balance.sandbox && <p className="error">The test-mode trial balance is not balanced.</p>}
      {!rec.trial_balance.live && <p className="error">The live trial balance is not balanced.</p>}
      {rec.held_mismatches.length > 0 && (
        <table><caption>Funds held vs funded payments</caption>
          <thead><tr><th scope="col">Contract</th><th scope="col">Mode</th><th scope="col">Ledger holds</th><th scope="col">Funded payments</th></tr></thead>
          <tbody>{rec.held_mismatches.map((m) => <tr key={`${m.mode}-${m.contract_id}`}><td>{m.contract_id.slice(0, 8)}</td><td>{m.mode}</td><td>{formatMinor(m.ledger_held_minor, 'INR')}</td><td>{formatMinor(m.funded_intents_minor, 'INR')}</td></tr>)}</tbody>
        </table>
      )}
      <h4>Approved but not released ({data.approved_not_released.length})</h4>
      <p className="muted small">{data.definitions.approved_not_released}</p>
      {data.approved_not_released.map((r) => <p key={r.id}>{amount(r)} · milestone {Number(r.milestone_index ?? 0) + 1} · contract {String(r.contract_id).slice(0, 8)} · {r.mode}</p>)}
      {data.approved_not_released.length > 0 && <button className="btn primary" type="button" disabled={busy} onClick={() => void act('/api/v1/admin/finance-exceptions/retry-releases')}>Retry releases now (admin)</button>}
      <h4>Unpaid checkouts older than 24 hours ({data.stale_checkouts.length})</h4>
      {data.stale_checkouts.map((r) => (
        <p key={r.id}>{amount(r)} · {r.mode} · started {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'} <button className="btn" type="button" disabled={busy} onClick={() => void act(`/api/v1/admin/payments/${r.id}/cancel-checkout`, { note: 'Stale checkout cancelled from finance exceptions' })}>Cancel checkout</button></p>
      ))}
      <h4>Failed payments, last 30 days ({data.failed_payments.length})</h4>
      {data.failed_payments.map((r) => <p key={r.id}>{amount(r)} · {r.mode} · {r.updated_at ? new Date(r.updated_at).toLocaleDateString() : ''}</p>)}
      <h4>Payout exceptions ({data.payout_exceptions.length})</h4>
      <p className="muted small">{data.definitions.payout_exceptions}</p>
      {data.payout_exceptions.map((r) => <p key={r.id}>{amount(r)} · {r.status} · {r.mode}</p>)}
    </section>
  );
}
