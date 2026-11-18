'use client';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/** Platform fee estimate for a contract total, from the approved fee schedule (D-5). */

type Quote = { client_fee_minor: number; freelancer_fee_minor: number; client_pays_minor: number; freelancer_receives_minor: number; currency: string };

export function FeeEstimate({ amountMinor, currency, party }: { amountMinor: number; currency: string; party: 'client' | 'freelancer' }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) { setQuote(null); return; }
    // Debounced: the amount changes while someone types a price.
    const timer = setTimeout(() => {
      api<Quote>(`/api/v1/finance/fee-quote?amount_minor=${amountMinor}&currency=${currency}`)
        .then((q) => { if (!cancelled && q && typeof q.client_pays_minor === 'number') { setQuote(q); setNote(''); } })
        .catch((e) => { if (!cancelled) { setQuote(null); setNote(e instanceof ApiError && e.code === 'FEES_NOT_CONFIGURED' ? 'Platform fees have not been decided yet.' : ''); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [amountMinor, currency]);

  if (quote) {
    return party === 'client'
      ? <p className="muted" data-testid="fee-estimate">All-in cost for you: <b>{formatMinor(quote.client_pays_minor, quote.currency)}</b> ({formatMinor(amountMinor, quote.currency)} + {formatMinor(quote.client_fee_minor, quote.currency)} platform fee).</p>
      : <p className="muted" data-testid="fee-estimate">You would receive <b>{formatMinor(quote.freelancer_receives_minor, quote.currency)}</b> ({formatMinor(amountMinor, quote.currency)} − {formatMinor(quote.freelancer_fee_minor, quote.currency)} platform fee).</p>;
  }
  return note ? <p className="muted">{note}</p> : null;
}
