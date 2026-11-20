'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/**
 * Milestone funding, invoices and mutual cancellation for one contract.
 * In sandbox mode every step is a test with no real money.
 */

type Payment = { id: string; status: string; amount_minor: number; client_fee_minor: number; freelancer_fee_minor: number; total_minor: number; currency: string; mode: string };
type Milestone = { index: number; title: string; amount_minor: number; payment: Payment | null };
type Invoice = { id: string; number: string; milestone_title: string; total_minor: number; status: string; mode: string };
type Cancellation = { id: string; requested_by: string; mine: boolean; reason: string; status: string; answer_by?: string | null } | null;
type Payments = { enabled: boolean; mode: string | null; notice: string; fees_configured: boolean; require_funding: boolean; can_fund: boolean; milestones: Milestone[]; invoices: Invoice[]; cancellation: Cancellation };
type InvoiceDetail = { number: string; milestone_title: string; amount_minor: number; client_fee_minor: number; total_minor: number; currency: string; issued_to: string; created_at: string; status: string; notice: string };

const STATUS: Record<string, string> = { created: 'Checkout started', funded: 'Funded', released: 'Paid to freelancer', refunded: 'Refunded', failed: 'Payment failed' };

export function PaymentsPanel({ contractId, contractStatus, party, canManage, onChanged }: { contractId: string; contractStatus: string; party: 'client' | 'freelancer'; canManage: boolean; onChanged: () => void }) {
  const [data, setData] = useState<Payments | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<Payments>(`/api/v1/contracts/${contractId}/payments`);
      if (result && Array.isArray(result.milestones)) setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments.');
    }
  }, [contractId]);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<{ message?: string }>, after?: () => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      setNotice(result.message ?? 'Done');
      after?.();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const fund = (m: Milestone) => run(() => api(`/api/v1/contracts/${contractId}/milestones/${m.index}/fund`, 'POST', { idempotency_key: `fund-${contractId}-${m.index}-${Date.now()}` }));
  const complete = (p: Payment, outcome: 'succeed' | 'fail') => run(() => api(`/api/v1/payments/sandbox/${p.id}/complete`, 'POST', { outcome }));

  async function openInvoice(id: string) {
    try {
      setInvoice(await api<InvoiceDetail>(`/api/v1/billing/invoices/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the invoice.');
    }
  }

  function requestCancel(event: FormEvent) {
    event.preventDefault();
    void run(() => api(`/api/v1/contracts/${contractId}/cancellation`, 'POST', { reason }), () => setReason(''));
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : null;
  const c = data.cancellation;
  return (
    <section className="card" aria-label="Payments">
      <b>Payments</b>
      {data.mode === 'sandbox' && <p className="badge">TEST MODE — no real money moves</p>}
      {data.notice && <p className="muted">{data.notice}</p>}
      {data.enabled && !data.fees_configured && <p className="muted">Platform fees are not approved yet, so milestones cannot be funded.</p>}
      {data.require_funding && <p className="muted">Work on a milestone starts once it is funded.</p>}
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>

      <table>
        <thead><tr><th scope="col">Milestone</th><th scope="col">Amount</th><th scope="col">Payment</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {data.milestones.map((m) => (
            <tr key={m.index}>
              <td>{m.title}</td>
              <td>{formatMinor(m.amount_minor, 'INR')}</td>
              <td>
                {m.payment ? STATUS[m.payment.status] ?? m.payment.status : 'Not funded'}
                {m.payment && party === 'client' && m.payment.client_fee_minor > 0 && <div className="muted">You pay {formatMinor(m.payment.total_minor, m.payment.currency)} incl. fee {formatMinor(m.payment.client_fee_minor, m.payment.currency)}</div>}
                {m.payment && party === 'freelancer' && <div className="muted">You receive {formatMinor(m.payment.amount_minor - m.payment.freelancer_fee_minor, m.payment.currency)} after fee</div>}
              </td>
              <td>
                {data.enabled && data.can_fund && (!m.payment || ['failed'].includes(m.payment.status)) && (
                  <button className="btn primary" disabled={busy || !data.fees_configured} onClick={() => void fund(m)}>Fund milestone</button>
                )}
                {data.can_fund && m.payment?.status === 'created' && m.payment.mode === 'sandbox' && (
                  <>
                    <button className="btn primary" disabled={busy} onClick={() => void complete(m.payment!, 'succeed')}>Complete test payment</button>
                    <button className="btn" disabled={busy} onClick={() => void complete(m.payment!, 'fail')}>Simulate failure</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.invoices.length > 0 && (
        <>
          <b>Invoices</b>
          <ul>{data.invoices.map((i) => <li key={i.id}><button className="link" onClick={() => void openInvoice(i.id)}>{i.number}</button> · {i.milestone_title} · {formatMinor(i.total_minor, 'INR')} · {i.status}</li>)}</ul>
        </>
      )}
      {invoice && (
        <div className="card" aria-label="Invoice">
          <p className="badge">{invoice.notice}</p>
          <p><b>{invoice.number}</b> · {new Date(invoice.created_at).toLocaleDateString()} · Billed to {invoice.issued_to}</p>
          <p>{invoice.milestone_title}: {formatMinor(invoice.amount_minor, invoice.currency)} + platform fee {formatMinor(invoice.client_fee_minor, invoice.currency)} = <b>{formatMinor(invoice.total_minor, invoice.currency)}</b> ({invoice.status})</p>
          <button className="link" onClick={() => setInvoice(null)}>Close invoice</button>
        </div>
      )}

      {contractStatus === 'active' && canManage && (
        <div>
          <b>Cancel the contract</b>
          {!c || c.status !== 'open' ? (
            <form onSubmit={requestCancel}>
              <div className="field"><label htmlFor={`cancel-${contractId}`}>Reason (the other side has 48 hours to answer, silence counts as yes; a client can cancel a late order at once; unreleased funds are refunded)</label><textarea id={`cancel-${contractId}`} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <button className="btn" type="submit" disabled={busy || reason.trim().length < 10}>Request cancellation</button>
            </form>
          ) : c.mine ? (
            <p className="muted">You asked to cancel: “{c.reason}”. Waiting for the other side{c.answer_by ? ` until ${new Date(c.answer_by).toLocaleString()}; with no answer by then the contract is cancelled` : ''}. <button className="link" disabled={busy} onClick={() => void run(() => api(`/api/v1/contracts/${contractId}/cancellation/withdraw`, 'POST'))}>Withdraw request</button></p>
          ) : (
            <div>
              <p>The {c.requested_by} asked to cancel: “{c.reason}”</p>
              {c.answer_by && <p className="notice">Answer by {new Date(c.answer_by).toLocaleString()}. If you do not, the contract is cancelled and unreleased funds go back to the client.</p>}
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/contracts/${contractId}/cancellation/respond`, 'POST', { accept: true }))}>Agree to cancel</button>
                <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/contracts/${contractId}/cancellation/respond`, 'POST', { accept: false }))}>Decline</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
