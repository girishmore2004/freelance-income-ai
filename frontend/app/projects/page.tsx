'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NotificationLink } from '../notification-link';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatBudget } from '@/lib/listing-format';
import { Invitations, MarketplaceVisibility } from './invitations';
import { MyProposals, ProposalForm } from './proposal-form';
import { ReportButton } from './report-button';

/**
 * Native client projects for freelancers (Phase 2). Shows only published,
 * public listings, with the fields the client chose to make public.
 * Applying to native projects arrives with the hiring loop (Phase 3).
 */

type PublicListing = {
  id: string; published_at: string | null; client_name: string; title: string; category_slug: string; outcome: string;
  description: string; deliverables: string[]; skills: string[]; experience_level: string; budget_model: string;
  budget_min_minor: number | null; budget_max_minor: number | null; currency: string; deadline: string | null;
  milestones: string[]; acceptance_criteria: string[]; revision_rounds: number; confidential: boolean;
};
type Page = { items: PublicListing[]; next_before: string | null };
type Category = { slug: string; name: string };

export default function ProjectsPage() {
  const [token] = useSessionToken();
  const [items, setItems] = useState<PublicListing[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const [proposing, setProposing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchPage = useCallback(async (before: string | null, append: boolean, cat: string, q: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (cat) params.set('category', cat);
      if (q.trim()) params.set('q', q.trim());
      if (before) params.set('before', before);
      const page = await api<Page>(`/api/v1/marketplace/listings${params.toString() ? `?${params}` : ''}`);
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setNext(page.next_before);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') setClosed(true);
      else setError(e instanceof Error ? e.message : 'Could not load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    // The top-bar search opens /projects?q=…
    const initial = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('q') ?? '').slice(0, 100);
    if (initial) setQuery(initial);
    void fetchPage(null, false, '', initial);
    api<Category[]>('/api/v1/project-categories').then(setCategories).catch(() => setCategories([]));
  }, [token, fetchPage]);

  function search(event: FormEvent) {
    event.preventDefault();
    void fetchPage(null, false, category, query);
  }

  if (!token) {
    return <main className="shell"><div className="card"><h2>Client projects</h2><p className="muted">Sign in first, then open this page to browse projects posted by clients.</p><a className="btn" href="/">Go to sign in</a></div></main>;
  }

  return (
    <main className="shell">
      <div className="row between">
        <h2>Projects posted by clients</h2>
        <span className="row"><NotificationLink /><a className="link" href="/contracts">Contracts</a><a className="link" href="/">← Back to workspace</a></span>
      </div>

      {closed ? (
        <div className="card"><p className="muted">Client-posted projects open when the client marketplace launches. External matches stay on your workspace.</p></div>
      ) : (
        <>
          <MarketplaceVisibility />
          {notice && <p className="success" role="status">{notice}</p>}
          <Invitations onProposalSent={(message) => { setNotice(message); setRefreshKey((k) => k + 1); }} />
          <MyProposals refreshKey={refreshKey} />
          <h3>Public projects</h3>
          <form className="row" onSubmit={search} role="search">
            <div className="field">
              <label htmlFor="q">Search</label>
              <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} placeholder="Title or outcome" />
            </div>
            <div className="field">
              <label htmlFor="cat">Category</label>
              <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <button className="btn primary" type="submit" disabled={loading}>Search</button>
          </form>

          {error && <p className="error" role="alert">{error}</p>}
          {loading && items.length === 0 && <p className="muted">Loading projects…</p>}
          {!loading && !error && items.length === 0 && <p className="empty">No published projects match yet.</p>}

          {items.map((p) => (
            <article className="card item" key={p.id}>
              <div className="row between">
                <b>{p.title}</b>
                <span className="badge">{categories.find((c) => c.slug === p.category_slug)?.name ?? p.category_slug}</span>
              </div>
              <p className="muted">{p.client_name} · {formatBudget(p.budget_min_minor, p.budget_max_minor, p.currency, p.budget_model)} · {p.deadline ? `Deadline ${p.deadline}` : 'No deadline set'}</p>
              <p>{p.outcome}</p>
              <button className="link" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? 'Hide details' : 'Show details'}
              </button>
              {open === p.id && (
                <div>
                  {p.description && <p>{p.description}</p>}
                  {p.deliverables.length > 0 && <><b>Deliverables</b><ul>{p.deliverables.map((d) => <li key={d}>{d}</li>)}</ul></>}
                  {p.skills.length > 0 && <p className="muted">Skills: {p.skills.join(', ')}</p>}
                  {p.milestones.length > 0 && <><b>Milestones</b><ol>{p.milestones.map((m) => <li key={m}>{m}</li>)}</ol></>}
                  {p.acceptance_criteria.length > 0 && <><b>Acceptance criteria</b><ul>{p.acceptance_criteria.map((a) => <li key={a}>{a}</li>)}</ul></>}
                  <p className="muted">Experience: {p.experience_level} · Revision rounds: {p.revision_rounds}</p>
                  <div><ReportButton targetType="listing" targetId={p.id} /></div>
                  {proposing === p.id ? (
                    <ProposalForm
                      listingId={p.id}
                      budgetModel={p.budget_model}
                      onCancel={() => setProposing(null)}
                      onDone={(message) => { setProposing(null); setNotice(message); setRefreshKey((k) => k + 1); }}
                    />
                  ) : (
                    <button className="btn primary" onClick={() => setProposing(p.id)}>Send a proposal</button>
                  )}
                </div>
              )}
            </article>
          ))}

          {next && <button className="btn" disabled={loading} onClick={() => void fetchPage(next, true, category, query)}>{loading ? 'Loading…' : 'Load more'}</button>}
        </>
      )}
    </main>
  );
}
