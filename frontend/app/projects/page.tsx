'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NotificationLink } from '../notification-link';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatBudget } from '@/lib/listing-format';
import { Invitations, MarketplaceVisibility } from './invitations';
import { MyProposals, ProposalForm } from './proposal-form';
import { ReportButton } from './report-button';
import { PublicNav } from '../public-nav';
import { ExternalOpportunities } from './external-opportunities';

type View = 'all' | 'native' | 'external' | 'saved';
type Saved = PublicListing & { closes_at: string | null; status: string; open: boolean; note: string; saved_at: string };

/**
 * Projects posted by registered clients on this marketplace. Visitors can
 * browse and search (spec §2); signing in adds invitations, proposals and
 * reporting. Only published, public listings with the fields the client
 * chose to make public are shown.
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
  const [view, setView] = useState<View>('all');
  const [applied, setApplied] = useState('');
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const savedIds = new Set((saved ?? []).map((s) => s.id));

  const loadSaved = useCallback(async () => {
    try {
      const list = await api<Saved[]>('/api/v1/me/saved-listings');
      setSaved(Array.isArray(list) ? list : []);
    } catch {
      setSaved(null); // Saving needs the client marketplace and migration 0068.
    }
  }, []);

  useEffect(() => { if (token) void loadSaved(); }, [token, loadSaved]);

  async function toggleSave(id: string) {
    setError('');
    try {
      if (savedIds.has(id)) await api(`/api/v1/marketplace/listings/${id}/save`, 'DELETE');
      else await api(`/api/v1/marketplace/listings/${id}/save`, 'POST', {});
      await loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update saved projects.');
    }
  }

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
    // Visitors browse too; the list reloads once a session is known.
    // The top-bar search opens /projects?q=…
    const initial = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('q') ?? '').slice(0, 100);
    if (initial) { setQuery(initial); setApplied(initial); }
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'native' || v === 'external' || v === 'saved') setView(v);
    void fetchPage(null, false, '', initial);
    api<Category[]>('/api/v1/project-categories').then(setCategories).catch(() => setCategories([]));
  }, [token, fetchPage]);

  function search(event: FormEvent) {
    event.preventDefault();
    setApplied(query);
    void fetchPage(null, false, category, query);
  }

  return (
    <main className="shell">
      {!token && <div className="row between" style={{ marginBottom: 12 }}><a href="/" className="row" style={{ gap: 8 }}><span className="logo" aria-hidden="true">F</span><b>Freelance Income AI</b></a><PublicNav /></div>}
      <div className="row between">
        <h2>Find work</h2>
        {token && <span className="row"><NotificationLink /><a className="link" href="/contracts">Contracts</a></span>}
      </div>
      {!token && <p className="card muted">You are browsing as a visitor. <a className="link" href="/#signin">Sign in</a> to send proposals and see invitations.</p>}

      {closed ? (
        <>
          <div className="card"><p className="muted">Projects posted by clients open when the client marketplace launches.</p></div>
          {token && <ExternalOpportunities query={applied} />}
        </>
      ) : (
        <>
          {token && (
            <>
              <MarketplaceVisibility />
              {notice && <p className="success" role="status">{notice}</p>}
              <Invitations onProposalSent={(message) => { setNotice(message); setRefreshKey((k) => k + 1); }} />
              <MyProposals refreshKey={refreshKey} />
            </>
          )}
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
          {token && (
            <div className="ws-role" role="group" aria-label="Show" style={{ maxWidth: 460, margin: '4px 0 14px' }}>
              {([['all', 'All'], ['native', 'Native projects'], ['external', 'External opportunities'], ['saved', `Saved${saved && saved.length ? ` (${saved.length})` : ''}`]] as const).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>
              ))}
            </div>
          )}
          {token && view === 'saved' && (
            <section aria-labelledby="saved-heading">
              <h3 id="saved-heading">Saved projects</h3>
              {saved === null && <p className="muted">Saving projects is not available yet.</p>}
              {saved && saved.length === 0 && <p className="empty">Nothing saved yet. Use “Save” on a project to keep it here; its closing date appears on your calendar.</p>}
              {saved?.map((p) => (
                <article className="card item" key={p.id}>
                  <div className="row between"><b>{p.title}</b><span className={`badge${p.open ? ' native' : ''}`}>{p.open ? 'Taking proposals' : 'No longer open'}</span></div>
                  <p className="muted">{p.client_name} · {formatBudget(p.budget_min_minor, p.budget_max_minor, p.currency, p.budget_model)} · {p.deadline ? `Deadline ${p.deadline}` : 'No deadline set'}{p.closes_at ? ` · closes ${p.closes_at.slice(0, 10)}` : ''}</p>
                  <p>{p.outcome}</p>
                  <div className="row">
                    {p.open && <button className="btn primary" type="button" onClick={() => { setView('native'); setOpen(p.id); setProposing(p.id); }}>Send a proposal</button>}
                    <button className="btn" type="button" onClick={() => void toggleSave(p.id)}>Remove</button>
                  </div>
                </article>
              ))}
            </section>
          )}
          {token && (view === 'all' || view === 'external') && <ExternalOpportunities query={applied} />}
          {(view === 'all' || view === 'native') && <h3 style={{ marginTop: 18 }}>Native projects <span className="muted small">posted by registered clients on this marketplace</span></h3>}

          {(view === 'all' || view === 'native') && <>
          {error && <p className="error" role="alert">{error}</p>}
          {loading && items.length === 0 && <p className="muted">Loading projects…</p>}
          {!loading && !error && items.length === 0 && <p className="empty">No published projects match yet.</p>}

          {items.map((p) => (
            <article className="card item" key={p.id}>
              <div className="row between">
                <b>{p.title}</b>
                <span className="row" style={{ gap: 6 }}>
                  <span className="badge native">Native project</span><span className="badge">{categories.find((c) => c.slug === p.category_slug)?.name ?? p.category_slug}</span>
                  {token && saved !== null && <button className="btn" type="button" aria-pressed={savedIds.has(p.id)} onClick={() => void toggleSave(p.id)}>{savedIds.has(p.id) ? 'Saved' : 'Save'}</button>}
                </span>
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
                  {token && <div><ReportButton targetType="listing" targetId={p.id} /></div>}
                  {!token ? (
                    <a className="btn primary" href="/#signin">Sign in to send a proposal</a>
                  ) : proposing === p.id ? (
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
          </>}
        </>
      )}
    </main>
  );
}
