'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { PROPOSAL_LABELS, formatMinor } from '@/lib/listing-format';
import { TermsForm, type Terms } from '../../contracts/terms-form';
import type { FreelancerCard } from './match-panel';

/**
 * Proposals received for one listing: shortlist, decline, or make an offer
 * (contract version 1). The offer starts from the freelancer's price as a
 * single milestone; the client edits every amount before sending.
 */

type Proposal = {
  id: string; status: string; cover_letter: string; price_minor: number; currency: string; budget_model: string;
  estimated_days: number | null; invited: boolean; created_at: string; contract_id: string | null; contract_status: string | null;
  freelancer: FreelancerCard;
};

type ListingBrief = { title: string; deliverables: string[]; acceptance_criteria: string[]; revision_rounds: number; ownership_notes: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export function ProposalsPanel({ listingId, brief, canManage }: { listingId: string; brief: ListingBrief; canManage: boolean }) {
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [offerFor, setOfferFor] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await api<Proposal[]>(`/api/v1/listings/${listingId}/proposals`));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [listingId]);

  useEffect(() => { void load(); }, [load]);

  async function decide(p: Proposal, action: 'shortlist' | 'decline') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/listing-proposals/${p.id}/status`, 'POST', { action });
      setNotice(action === 'shortlist' ? `${p.freelancer.display_name} shortlisted` : 'Proposal declined');
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function initialTerms(p: Proposal): Terms {
    return {
      title: brief.title,
      scope: '',
      deliverables: brief.deliverables,
      milestones: [{ title: 'Complete project', amount_minor: p.price_minor, due_date: null }],
      revision_rounds: brief.revision_rounds,
      acceptance_criteria: brief.acceptance_criteria,
      ownership_terms: brief.ownership_notes,
    };
  }

  return (
    <section className="card" aria-label="Proposals">
      <b>Proposals</b>
      <div aria-live="polite">
        {notice && <p className="success">{notice} {notice.startsWith('Offer') && <a className="link" href="/contracts">Open contracts</a>}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {items && items.length === 0 && <p className="empty">No proposals yet.</p>}
      {items?.map((p) => (
        <div className="card item" key={p.id}>
          <div className="row between">
            <span><b>{p.freelancer.display_name}</b>{p.invited && <span className="badge"> Invited</span>}{p.freelancer.rating && <span className="muted"> ★ {p.freelancer.rating.average} ({p.freelancer.rating.count})</span>}</span>
            <span className="badge">{PROPOSAL_LABELS[p.status] ?? p.status}</span>
          </div>
          <p className="muted">
            {formatMinor(p.price_minor, p.currency)}{p.budget_model === 'hourly' ? ' per hour' : ''}
            {p.estimated_days ? ` · about ${p.estimated_days} days` : ''}
            {p.freelancer.headline ? ` · ${p.freelancer.headline}` : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.cover_letter}</p>
          {p.contract_id && <p className="muted">Contract {p.contract_status}. <a className="link" href="/contracts">Open contracts</a></p>}
          {canManage && ['submitted', 'shortlisted'].includes(p.status) && offerFor?.id !== p.id && (
            <div className="row">
              {p.status === 'submitted' && <button className="btn" disabled={busy} onClick={() => void decide(p, 'shortlist')}>Shortlist</button>}
              <button className="btn primary" disabled={busy} onClick={() => setOfferFor(p)}>Make an offer</button>
              <button className="btn" disabled={busy} onClick={() => void decide(p, 'decline')}>Decline</button>
            </div>
          )}
          {offerFor?.id === p.id && (
            <TermsForm
              initial={initialTerms(p)}
              submitLabel="Send offer"
              onCancel={() => setOfferFor(null)}
              onSubmit={async (terms) => {
                await api(`/api/v1/listing-proposals/${p.id}/offer`, 'POST', { terms });
                setOfferFor(null);
                setNotice(`Offer sent to ${p.freelancer.display_name}. It becomes a contract when they accept the same terms.`);
                await load();
              }}
            />
          )}
        </div>
      ))}
    </section>
  );
}
