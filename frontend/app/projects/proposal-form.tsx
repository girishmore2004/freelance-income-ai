'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { PROPOSAL_LABELS, formatMinor, minorToRupees, rupeesToMinor } from '@/lib/listing-format';

/**
 * Freelancer proposals on client-posted projects (Phase 3). The freelancer
 * sets the price; it is sent in paise and never changed by the platform.
 */

type Proposal = {
  id: string; listing_id: string; status: string; cover_letter: string; price_minor: number; currency: string; budget_model: string;
  estimated_days: number | null; project_title: string; listing_status: string; contract_id: string | null; contract_status: string | null;
};

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export function ProposalForm({ listingId, budgetModel, existing, onDone, onCancel }: {
  listingId: string;
  budgetModel: string;
  existing?: Proposal;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [cover, setCover] = useState(existing?.cover_letter ?? '');
  const [price, setPrice] = useState(existing ? minorToRupees(existing.price_minor) : '');
  const [days, setDays] = useState(existing?.estimated_days ? String(existing.estimated_days) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = existing?.id ?? listingId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = rupeesToMinor(price);
    if (amount === null || Number.isNaN(amount)) { setErrors({ price_minor: 'Enter your price in rupees, for example 30000.' }); return; }
    setBusy(true);
    setError('');
    setErrors({});
    const payload = { cover_letter: cover, price_minor: amount, estimated_days: days ? Number(days) : null };
    try {
      if (existing) await api(`/api/v1/listing-proposals/${existing.id}`, 'PUT', payload);
      else await api(`/api/v1/marketplace/listings/${listingId}/proposals`, 'POST', payload);
      onDone(existing ? 'Proposal updated' : 'Proposal sent');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_PROPOSAL') {
        const details = e.details[0];
        setErrors(details && typeof details === 'object' ? (details as Record<string, string>) : {});
        setError('Check the highlighted fields.');
      } else setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const err = (key: string) => (errors[key] ? <p className="error" id={`${key}-${id}-error`}>{errors[key]}</p> : null);
  return (
    <form className="card" onSubmit={(e) => void submit(e)} noValidate aria-label="Proposal">
      <div className="field">
        <label htmlFor={`cover-${id}`}>How you would do the work (50–5,000 characters)</label>
        <textarea id={`cover-${id}`} rows={5} maxLength={5000} value={cover} onChange={(e) => setCover(e.target.value)} aria-invalid={Boolean(errors.cover_letter)} />
        {err('cover_letter')}
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor={`price-${id}`}>Your price (₹){budgetModel === 'hourly' ? ' per hour' : ''}</label>
          <input id={`price-${id}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={Boolean(errors.price_minor)} />
          {err('price_minor')}
        </div>
        <div className="field">
          <label htmlFor={`days-${id}`}>Estimated days (optional)</label>
          <input id={`days-${id}`} type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} />
          {err('estimated_days')}
        </div>
      </div>
      <p className="muted">Keep contact and payment on the platform. Proposals with phone numbers, emails or payment requests are refused.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : existing ? 'Save proposal' : 'Send proposal'}</button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

export function MyProposals({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api<Proposal[]>('/api/v1/me/proposals');
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'FEATURE_DISABLED')) setError(messageOf(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function withdraw(p: Proposal) {
    setError('');
    try {
      await api(`/api/v1/listing-proposals/${p.id}/withdraw`, 'POST');
      setNotice('Proposal withdrawn');
      await load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  if (!items || (items.length === 0 && !error)) return null;
  return (
    <section aria-labelledby="my-proposals-heading">
      <h3 id="my-proposals-heading">Your proposals</h3>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {items.map((p) => (
        <div className="card item" key={p.id}>
          <div className="row between"><b>{p.project_title}</b><span className="badge">{PROPOSAL_LABELS[p.status] ?? p.status}</span></div>
          <p className="muted">{formatMinor(p.price_minor, p.currency)}{p.budget_model === 'hourly' ? ' per hour' : ''}{p.estimated_days ? ` · ${p.estimated_days} days` : ''}</p>
          {p.contract_id && <p><a className="link" href="/contracts">{p.contract_status === 'active' ? 'Open your contract' : 'Review the offer'}</a></p>}
          {['submitted', 'shortlisted'].includes(p.status) && editing !== p.id && (
            <div className="row">
              <button className="btn" onClick={() => setEditing(p.id)}>Edit</button>
              <button className="btn" onClick={() => void withdraw(p)}>Withdraw</button>
            </div>
          )}
          {editing === p.id && (
            <ProposalForm
              listingId={p.listing_id}
              budgetModel={p.budget_model}
              existing={p}
              onCancel={() => setEditing(null)}
              onDone={(message) => { setEditing(null); setNotice(message); void load(); }}
            />
          )}
        </div>
      ))}
    </section>
  );
}
