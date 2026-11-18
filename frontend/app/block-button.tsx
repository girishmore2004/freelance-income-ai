'use client';
import { useId, useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * Block between a freelancer and a client account (U23, Master Plan Step 6).
 * Two steps on the page (no browser dialog): "Block…" opens a short form with
 * an optional reason, then "Confirm block". The server refuses while an offer
 * or contract between them is open and explains what to do instead.
 */
export type BlockTarget = { listing_id: string } | { proposal_id: string } | { freelancer_user_id: string; organization_id: string };

export function BlockButton({ target, label, effect, onBlocked }: { target: BlockTarget; label: string; effect: string; onBlocked?: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string }>('/api/v1/blocks', 'POST', { ...target, reason: reason.trim() });
      setDone(r && typeof r === 'object' ? 'Blocked. You can unblock on Account and team.' : 'Blocked.');
      setOpen(false);
      onBlocked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not block.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="success small" role="status">{done}</p>;
  return (
    <span className="block-action">
      {!open ? (
        <button className="link" type="button" onClick={() => setOpen(true)}>{label}</button>
      ) : (
        <span className="card" role="group" aria-label={label} style={{ display: 'block', marginTop: 8 }}>
          <p className="small">{effect}</p>
          <label className="small" htmlFor={`block-${id}`}>Reason (optional, only you see it)</label>
          <input id={`block-${id}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="row">
            <button className="btn" type="button" disabled={busy} onClick={() => void confirm()}>Confirm block</button>
            <button className="link" type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </span>
          {error && <span className="error small" role="alert">{error}</span>}
        </span>
      )}
    </span>
  );
}
