'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { PROPOSAL_LABELS, formatMinor } from '@/lib/listing-format';
import { TermsForm, type Terms } from '../../contracts/terms-form';
import type { FreelancerCard } from './match-panel';
import { ProposalHistory, SectionsView } from '../../projects/proposal-form';
import { DiscussionPanel } from '../../inbox/discussion-panel';
import { scopeSummary, type StudioSections } from '@/lib/proposal-studio';

/**
 * Proposals received for one listing: shortlist, decline, or make an offer
 * (contract version 1). The offer starts from the freelancer's price as a
 * single milestone; the client edits every amount before sending.
 */

type Proposal = {
  id: string; status: string; cover_letter: string; price_minor: number; currency: string; budget_model: string;
  estimated_days: number | null; invited: boolean; created_at: string; contract_id: string | null; contract_status: string | null;
  freelancer: FreelancerCard;
  sections?: StudioSections | null; current_version?: number; revision_requested_at?: string | null; revision_note?: string | null;
};

type ComparisonRow = {
  proposal_id: string; freelancer_name: string; price_minor: number; budget_fit: string; estimated_days: number | null; timeline_fit: string;
  skills_covered: string[]; skills_missing: string[]; deliverables_mentioned: number; deliverables_total: number;
  rating: { average: number; count: number } | null; invited: boolean; notes: string[];
  deliverables?: string[]; milestones?: unknown[]; assumptions?: string[]; exclusions?: string[]; questions?: string[]; evidence_count?: number; version?: number;
};
type Comparison = { rows: ComparisonRow[]; disclaimer: string };
type Suggested = { terms: Terms; missing_terms: string[]; note: string };

const FIT: Record<string, string> = { within: 'Within budget', below: 'Below budget', above: 'Above budget', no_budget: 'No budget set', fits: 'Fits deadline', tight: 'Tight', late: 'Past deadline', no_deadline: 'No deadline', not_stated: 'Not stated' };

type ListingBrief = { title: string; deliverables: string[]; acceptance_criteria: string[]; revision_rounds: number; ownership_notes: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export function ProposalsPanel({ listingId, brief, canManage }: { listingId: string; brief: ListingBrief; canManage: boolean }) {
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [offerFor, setOfferFor] = useState<Proposal | null>(null);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<string | null>(null);
  const [talk, setTalk] = useState<string | null>(null);
  const [revisionFor, setRevisionFor] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState('');

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

  async function requestRevision(p: Proposal) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/listing-proposals/${p.id}/status`, 'POST', { action: 'request_revision', note: revisionNote });
      setNotice(`Asked ${p.freelancer.display_name} for a revised proposal`);
      setRevisionFor(null);
      setRevisionNote('');
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    setError('');
    try {
      const result = await api<Comparison>(`/api/v1/listings/${listingId}/proposal-comparison`);
      setComparison(result && Array.isArray(result.rows) ? result : null);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function startOffer(p: Proposal) {
    setSuggested(null);
    try {
      const result = await api<Suggested>(`/api/v1/listing-proposals/${p.id}/suggested-terms`);
      if (result && result.terms && Array.isArray(result.terms.milestones)) setSuggested(result);
    } catch {
      // The assistant is optional: fall back to a single milestone at the quoted price.
    }
    setOfferFor(p);
  }

  function initialTerms(p: Proposal): Terms {
    if (suggested) return suggested.terms;
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
      {items && items.length > 1 && !comparison && <button className="btn" type="button" onClick={() => void compare()}>Compare proposals</button>}
      {comparison && (
        <div>
          <p className="muted">{comparison.disclaimer}</p>
          <table>
            <caption>Proposal comparison</caption>
            <thead><tr><th scope="col">Freelancer</th><th scope="col">Price</th><th scope="col">Budget</th><th scope="col">Timeline</th><th scope="col">Skills</th><th scope="col">Deliverables mentioned</th><th scope="col">Scope details</th><th scope="col">Flags</th></tr></thead>
            <tbody>
              {comparison.rows.map((r) => (
                <tr key={r.proposal_id}>
                  <td>{r.freelancer_name}{r.rating ? ` ★ ${r.rating.average}` : ''}{r.invited ? ' (invited)' : ''}</td>
                  <td>{formatMinor(r.price_minor, 'INR')}</td>
                  <td>{FIT[r.budget_fit] ?? r.budget_fit}</td>
                  <td>{r.estimated_days ? `${r.estimated_days} days · ` : ''}{FIT[r.timeline_fit] ?? r.timeline_fit}</td>
                  <td>{r.skills_covered.join(', ') || '—'}{r.skills_missing.length ? ` (missing ${r.skills_missing.join(', ')})` : ''}</td>
                  <td>{r.deliverables_mentioned}/{r.deliverables_total}</td>
                  <td>{scopeSummary(r.deliverables ? { deliverables: r.deliverables, milestones: r.milestones ?? [], assumptions: r.assumptions ?? [], exclusions: r.exclusions ?? [], questions: r.questions ?? [] } : null)}{r.evidence_count ? ` · ${r.evidence_count} portfolio link${r.evidence_count === 1 ? '' : 's'}` : ''}{(r.version ?? 1) > 1 ? ` · version ${r.version}` : ''}</td>
                  <td>{r.notes.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link" type="button" onClick={() => setComparison(null)}>Hide comparison</button>
        </div>
      )}
      {items?.map((p) => (
        <div className="card item" key={p.id}>
          <div className="row between">
            <span><b>{p.freelancer.display_name}</b>{p.invited && <span className="badge"> Invited</span>}{p.freelancer.verified && <span className="badge" title="Staff reviewed this freelancer's public work evidence. Not an identity check."> Reviewed</span>}{p.freelancer.rating && <span className="muted"> ★ {p.freelancer.rating.average} ({p.freelancer.rating.count})</span>}</span>
            <span className="row" style={{ gap: 6 }}>
              {(p.current_version ?? 1) > 1 && <span className="badge">Version {p.current_version}</span>}
              <span className="badge">{PROPOSAL_LABELS[p.status] ?? p.status}</span>
            </span>
          </div>
          <p className="muted">
            {formatMinor(p.price_minor, p.currency)}{p.budget_model === 'hourly' ? ' per hour' : ''}
            {p.estimated_days ? ` · about ${p.estimated_days} days` : ''}
            {p.freelancer.headline ? ` · ${p.freelancer.headline}` : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.cover_letter}</p>
          {p.sections && <SectionsView sections={p.sections} currency={p.currency} />}
          {p.revision_requested_at && <p className="muted">You asked for a revision: “{p.revision_note}”. Waiting for a new version.</p>}
          <button className="link" type="button" aria-expanded={history === p.id} onClick={() => setHistory(history === p.id ? null : p.id)}>{history === p.id ? 'Hide version history' : 'Version history'}</button>
          {history === p.id && <ProposalHistory proposalId={p.id} currency={p.currency} />}
          {['submitted', 'shortlisted'].includes(p.status) && (
            <button className="link" type="button" aria-expanded={talk === p.id} onClick={() => setTalk(talk === p.id ? null : p.id)}>{talk === p.id ? 'Hide messages and interviews' : 'Messages and interviews'}</button>
          )}
          {talk === p.id && <DiscussionPanel proposalId={p.id} />}
          {p.contract_id && <p className="muted">Contract {p.contract_status}. <a className="link" href="/contracts">Open contracts</a></p>}
          {canManage && ['submitted', 'shortlisted'].includes(p.status) && offerFor?.id !== p.id && (
            <div className="row">
              {p.status === 'submitted' && <button className="btn" disabled={busy} onClick={() => void decide(p, 'shortlist')}>Shortlist</button>}
              <button className="btn primary" disabled={busy} onClick={() => void startOffer(p)}>Make an offer</button>
              <button className="btn" disabled={busy} onClick={() => { setRevisionFor(revisionFor === p.id ? null : p.id); setRevisionNote(''); }}>Request revised proposal</button>
              <button className="btn" disabled={busy} onClick={() => void decide(p, 'decline')}>Decline</button>
            </div>
          )}
          {revisionFor === p.id && (
            <div className="card">
              <div className="field">
                <label htmlFor={`revise-${p.id}`}>What should change? (5–1,000 characters)</label>
                <textarea id={`revise-${p.id}`} rows={3} maxLength={1000} value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} />
              </div>
              <div className="row">
                <button className="btn primary" type="button" disabled={busy || revisionNote.trim().length < 5} onClick={() => void requestRevision(p)}>Send request</button>
                <button className="btn" type="button" onClick={() => setRevisionFor(null)}>Cancel</button>
              </div>
            </div>
          )}
          {offerFor?.id === p.id && suggested && (
            <div className="muted">
              <p>{suggested.note}</p>
              {suggested.missing_terms.length > 0 && <ul>{suggested.missing_terms.map((m) => <li key={m}>{m}</li>)}</ul>}
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
