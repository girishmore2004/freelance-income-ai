'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { rupeesToMinor } from '@/lib/listing-format';

/**
 * Saved searches with job alerts (U12). Saving keeps the current words and
 * category (and an optional minimum budget); with alerts on, a notification
 * arrives when a matching project is published. Each search shows how many
 * matching projects appeared since it was last opened.
 */

type Search = {
  id: string; name: string; query: string; category_slug: string; min_budget_minor: number | null; skills: string[]; alerts: boolean;
  new_count: number; new_projects: Array<{ id: string; title: string }>;
};
type State = { available: boolean; items: Search[]; max?: number };

export function SavedSearches({ query, category, onOpen }: { query: string; category: string; onOpen: (id: string) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<State>('/api/v1/me/saved-searches');
      setState(r && Array.isArray(r.items) ? r : null);
    } catch {
      setState(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<{ message?: string } | unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      const field = e instanceof ApiError && Array.isArray(e.details) && e.details[0] && typeof e.details[0] === 'object' ? Object.values(e.details[0] as Record<string, string>)[0] : '';
      setError(field || (e instanceof Error ? e.message : 'Something went wrong.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const min = budget.trim() ? rupeesToMinor(budget) : null;
    if (budget.trim() && min === null) { setError('Enter the minimum budget in rupees, e.g. 25000.'); return; }
    const ok = await run(() => api('/api/v1/me/saved-searches', 'POST', { name: name.trim() || query.trim() || 'My search', query, category_slug: category, min_budget_minor: min, alerts: true }), 'Search saved. You will be notified about new matching projects.');
    if (ok) { setAdding(false); setName(''); setBudget(''); }
  }

  if (!state || !state.available) return null;
  return (
    <section className="card" aria-label="Saved searches">
      <div className="row between">
        <b>Saved searches and alerts</b>
        {!adding && state.items.length < (state.max ?? 10) && <button className="btn" type="button" onClick={() => setAdding(true)}>Save this search</button>}
      </div>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {adding && (
        <form className="row" onSubmit={save} aria-label="Save this search">
          <div className="field">
            <label htmlFor="ss-name">Name</label>
            <input id="ss-name" maxLength={80} value={name} placeholder={query || 'e.g. Next.js websites'} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ss-budget">Minimum budget (₹, optional)</label>
            <input id="ss-budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <p className="muted small">Uses your current words{category ? ' and category' : ''}{!query && !category ? ' (add words, a category or a budget first)' : ''}.</p>
          <button className="btn primary" type="submit" disabled={busy}>Save and alert me</button>
          <button className="btn" type="button" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {state.items.length === 0 && !adding && <p className="muted">Save a search to get a notification when a matching project is posted.</p>}
      <ul aria-label="Your saved searches">
        {state.items.map((s) => (
          <li key={s.id} className="item">
            <div className="row between">
              <span><b>{s.name}</b>{s.new_count > 0 && <span className="badge"> {s.new_count} new</span>}
                <span className="muted small"> · {[s.query && `“${s.query}”`, s.category_slug, s.min_budget_minor !== null && `from ₹${(s.min_budget_minor / 100).toLocaleString('en-IN')}`, s.skills.length ? s.skills.join(', ') : ''].filter(Boolean).join(' · ')}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <label className="row small" style={{ gap: 4 }}>
                  <input type="checkbox" checked={s.alerts} disabled={busy} onChange={() => void run(() => api(`/api/v1/saved-searches/${s.id}`, 'POST', { alerts: !s.alerts }), s.alerts ? 'Alerts off' : 'Alerts on')} />
                  Alerts for {s.name}
                </label>
                <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/saved-searches/${s.id}/delete`, 'POST', {}), 'Saved search removed')}>Remove</button>
              </span>
            </div>
            {s.new_projects.length > 0 && (
              <ul>
                {s.new_projects.map((p) => (
                  <li key={p.id}><button className="link" type="button" onClick={() => { onOpen(p.id); void api(`/api/v1/saved-searches/${s.id}/seen`, 'POST', {}).then(load).catch(() => undefined); }}>{p.title}</button></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
