'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/** Finance staff: recent milestone payments and refunds of unreleased funds (logged). */

type Payment = { id: string; contract_id: string; milestone_index: number; total_minor: number; currency: string; mode: string; status: string; provider_ref: string };

export function AdminPayments() {
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<Payment[]>('/api/v1/admin/payments');
      setRows(Array.isArray(result) ? result : []);
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 403))) setMessage(e instanceof Error ? e.message : 'Could not load payments.');
      setRows(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refund(p: Payment) {
    try {
      const result = await api<{ message?: string }>(`/api/v1/admin/payments/${p.id}/refund`, 'POST', { note: notes[p.id] ?? '' });
      setMessage(result.message ?? 'Refunded');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not refund.');
    }
  }

  if (!rows) return message ? <p className="error">{message}</p> : null;
  return (
    <section className="card" aria-labelledby="payments-heading">
      <h3 id="payments-heading">Milestone payments</h3>
      {message && <p className="muted" role="status">{message}</p>}
      {rows.length === 0 ? <p className="empty">No payments yet.</p> : (
        <ul>
          {rows.map((p) => (
            <li key={p.id}>
              {p.mode === 'sandbox' ? '[TEST] ' : ''}Contract {p.contract_id.slice(0, 8)} · milestone {p.milestone_index + 1} · {formatMinor(p.total_minor, p.currency)} · <span className="badge">{p.status}</span>
              {['created', 'funded'].includes(p.status) && (
                <span> <input aria-label={`Refund reason for ${p.id}`} placeholder="Reason" value={notes[p.id] ?? ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} /> <button className="btn" onClick={() => void refund(p)}>Refund</button></span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
