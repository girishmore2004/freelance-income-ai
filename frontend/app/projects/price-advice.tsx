'use client';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/**
 * F5 Pricing and Scope agent: an advisory range from the client's budget, the
 * freelancer's own minimum and rate, and their past winning prices. Rules
 * only, every reason shown; the freelancer sets the price.
 */
type Advice =
  | { available: true; low_minor: number; high_minor: number; basis: string[]; warnings: string[]; assumptions: string[]; exclusions: string[]; note: string }
  | { available: false; basis: string[]; warnings: string[]; note: string };

export function PriceAdvice({ listingId, onUse }: { listingId: string; onUse: (rupees: string, assumptions: string[], exclusions: string[]) => void }) {
  const [hours, setHours] = useState('');
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    setError('');
    try {
      const h = Number(hours);
      setAdvice(await api<Advice>(`/api/v1/marketplace/listings/${listingId}/price-advice${Number.isInteger(h) && h > 0 ? `?hours=${h}` : ''}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not suggest a price.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card" aria-label="Price advice">
      <summary>Not sure what to charge? Get a price range</summary>
      <div className="row">
        <div className="field"><label htmlFor={`pa-hours-${listingId}`}>Hours you expect (optional)</label><input id={`pa-hours-${listingId}`} type="number" min={1} max={2000} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        <button className="btn" type="button" disabled={busy} onClick={() => void ask()}>{busy ? 'Working…' : 'Suggest a price'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {advice && (
        <div role="status">
          {advice.available ? <p><b>Suggested: {formatMinor(advice.low_minor, 'INR')} – {formatMinor(advice.high_minor, 'INR')}</b></p> : <p className="muted">No range yet.</p>}
          {advice.basis.length > 0 && <ul className="small">{advice.basis.map((b) => <li key={b}>{b}</li>)}</ul>}
          {advice.warnings.map((w) => <p key={w} className="error small">{w}</p>)}
          {advice.available && (
            <button className="btn" type="button" onClick={() => onUse(String(Math.round(advice.low_minor / 100)), advice.assumptions, advice.exclusions)}>Use {formatMinor(advice.low_minor, 'INR')} and add the assumptions</button>
          )}
          <p className="muted small">{advice.note}</p>
        </div>
      )}
    </details>
  );
}
