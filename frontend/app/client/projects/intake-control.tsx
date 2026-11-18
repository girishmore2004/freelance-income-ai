'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';

/**
 * Client load control (Master Plan B12.2): cap the proposals a project takes,
 * or stop taking new ones. Reaching the cap closes the project by itself;
 * the client can reopen it (with a higher cap or none).
 */
type Intake = { max_proposals: number | null; closed: boolean; received: number; can_edit: boolean };

export function IntakeControl({ listingId }: { listingId: string }) {
  const id = useId();
  const [data, setData] = useState<Intake | null>(null);
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Intake>(`/api/v1/listings/${listingId}/intake`);
      if (r && typeof r.received === 'number') { setData(r); setCap(r.max_proposals === null ? '' : String(r.max_proposals)); }
    } catch {
      setUnavailable(true);
    }
  }, [listingId]);
  useEffect(() => { void load(); }, [load]);

  async function save(accepting: boolean) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<Intake & { message?: string }>(`/api/v1/listings/${listingId}/intake`, 'POST', { max_proposals: cap.trim() === '' ? null : Number(cap), accepting });
      setData(r);
      setNotice(accepting ? 'Saved. The project takes proposals.' : 'Saved. No new proposals will arrive.');
    } catch (e) {
      if (e instanceof ApiError && e.details[0] && typeof e.details[0] === 'object') {
        const d = e.details[0] as Record<string, string>;
        setError(d.max_proposals ?? e.message);
      } else setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (unavailable || !data) return null;
  return (
    <div className="card" aria-label="Proposal limit">
      <p className="row between">
        <span><b>{data.received}</b> proposal{data.received === 1 ? '' : 's'} received{data.max_proposals !== null ? ` of up to ${data.max_proposals}` : ''}</span>
        <span className="badge">{data.closed ? 'Not taking new proposals' : 'Taking proposals'}</span>
      </p>
      {data.can_edit && (
        <div className="row">
          <div className="field">
            <label htmlFor={`cap-${id}`}>Stop after this many proposals (empty = no limit)</label>
            <input id={`cap-${id}`} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </div>
          {data.closed
            ? <button className="btn primary" type="button" disabled={busy} onClick={() => void save(true)}>Take proposals again</button>
            : <>
                <button className="btn" type="button" disabled={busy} onClick={() => void save(true)}>Save limit</button>
                <button className="btn" type="button" disabled={busy} onClick={() => void save(false)}>Stop taking proposals</button>
              </>}
        </div>
      )}
      <div aria-live="polite">{notice && <p className="success small">{notice}</p>}{error && <p className="error small" role="alert">{error}</p>}</div>
    </div>
  );
}
