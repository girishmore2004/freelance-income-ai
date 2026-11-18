'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';

/** Lets any signed-in user report a listing (or another target) to staff. */

const REASONS: Array<[string, string]> = [
  ['scam', 'Scam or fraud'], ['off_platform', 'Asks to pay or talk outside the platform'], ['prohibited', 'Prohibited work'],
  ['fake', 'Fake or misleading'], ['spam', 'Spam'], ['abuse', 'Abusive'], ['other', 'Something else'],
];

export function ReportButton({ targetType, targetId }: { targetType: 'listing' | 'user' | 'proposal' | 'contract_message' | 'review' | 'service'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('scam');
  const [details, setDetails] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ message?: string }>('/api/v1/reports', 'POST', { target_type: targetType, target_id: targetId, reason, details });
      setMessage(result.message ?? 'Thank you. Staff will review your report.');
      setOpen(false);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      {!open && <button className="link" type="button" onClick={() => { setOpen(true); setMessage(''); }}>Report</button>}
      {message && <span className="muted" role="status"> {message}</span>}
      {open && (
        <form onSubmit={(e) => void submit(e)} aria-label="Report">
          <div className="field">
            <label htmlFor={`reason-${targetId}`}>Reason</label>
            <select id={`reason-${targetId}`} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="field"><label htmlFor={`details-${targetId}`}>Details (optional)</label><textarea id={`details-${targetId}`} rows={2} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>Send report</button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </span>
  );
}
