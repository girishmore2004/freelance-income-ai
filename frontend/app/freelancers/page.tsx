'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, useSessionToken } from '@/lib/api-client';
import { PublicNav } from '../public-nav';

/**
 * Browse freelancers and open a public profile (spec §2 and §9). Only
 * freelancers who chose to be visible to clients appear; ratings come from
 * revealed client reviews and work history from completed contracts on this
 * marketplace. No email, minimum budget or private preferences are shown.
 */

type Card = {
  user_id: string; display_name: string; headline: string; skills: string[]; services: string[]; hourly_rate: number | null; currency: string;
  weekly_hours: number | null; timezone: string; newcomer: boolean; verified?: boolean; rating: { average: number; count: number } | null; completed_contracts: number;
};
type Profile = Card & { reviews: Array<{ rating: number; comment: string; created_at: string }> };
type Directory = { open: boolean; items: Card[]; more: boolean };

const stars = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

function rate(c: Card): string {
  return c.hourly_rate ? `${c.currency === 'INR' ? '₹' : `${c.currency} `}${c.hourly_rate.toLocaleString('en-IN')}/hour` : 'Rate on request';
}

export default function FreelancersPage() {
  const [token] = useSessionToken();
  const [dir, setDir] = useState<Directory | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (q: string, from: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (from) params.set('offset', String(from));
      const result = await api<Directory>(`/api/v1/public/freelancers${params.toString() ? `?${params}` : ''}`);
      if (result && Array.isArray(result.items)) setDir((current) => (append && current ? { ...result, items: [...current.items, ...result.items] } : result));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load freelancers.');
    } finally {
      setLoading(false);
    }
  }, []);

  const openProfile = useCallback(async (id: string) => {
    setError('');
    try {
      const p = await api<Profile>(`/api/v1/public/freelancers/${encodeURIComponent(id)}`);
      if (p && typeof p.user_id === 'string') setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This profile is not available.');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const q = (params.get('q') ?? '').slice(0, 100);
    if (q) setQuery(q);
    if (id) void openProfile(id);
    else void load(q, 0, false);
  }, [load, openProfile]);

  function search(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    void load(query, 0, false);
  }

  function show(id: string | null) {
    const url = id ? `/freelancers?id=${encodeURIComponent(id)}` : '/freelancers';
    window.history.pushState({}, '', url);
    if (id) void openProfile(id);
    else {
      setProfile(null);
      if (!dir) void load(query, 0, false);
    }
  }

  return (
    <main className="shell">
      {!token && <div className="row between" style={{ marginBottom: 12 }}><a href="/" className="row" style={{ gap: 8 }}><span className="logo" aria-hidden="true">F</span><b>Freelance Income AI</b></a><PublicNav /></div>}
      <h2>Find freelancers</h2>
      <p className="muted">Freelancers who chose to be visible to clients. Ratings come only from completed contracts on this marketplace.</p>
      {error && <p className="error" role="alert">{error}</p>}

      {profile ? (
        <article className="card" aria-labelledby="profile-name">
          <button className="link" type="button" onClick={() => show(null)}>← All freelancers</button>
          <div className="row between" style={{ marginTop: 8 }}>
            <h3 id="profile-name">{profile.display_name}</h3>
            {profile.newcomer && <span className="badge native">New to the marketplace</span>}
            {profile.verified && <span className="badge" title="Staff reviewed this freelancer's public work evidence. Not an identity check.">Reviewed by staff</span>}
          </div>
          {profile.headline && <p>{profile.headline}</p>}
          <p className="muted">{rate(profile)} · {profile.weekly_hours ? `${profile.weekly_hours} hours/week` : 'availability not stated'} · {profile.timezone || 'time zone not stated'}</p>
          <p>{profile.rating ? <><span aria-hidden="true">{stars(profile.rating.average)}</span> {profile.rating.average} from {profile.rating.count} client review{profile.rating.count === 1 ? '' : 's'}</> : 'No client reviews yet'} · {profile.completed_contracts} completed contract{profile.completed_contracts === 1 ? '' : 's'} here</p>
          {profile.skills.length > 0 && <div className="chips">{profile.skills.map((s) => <span className="chip ok" key={s}>{s}</span>)}</div>}
          {profile.services.length > 0 && <><b>Services</b><ul>{profile.services.map((s) => <li key={s}>{s}</li>)}</ul></>}
          {profile.reviews.length > 0 && (
            <>
              <b>Recent client reviews</b>
              <ul>{profile.reviews.map((r, i) => <li key={i}><span aria-label={`${r.rating} out of 5`}>{stars(r.rating)}</span> {r.comment || <span className="muted">No comment</span>} <span className="muted small">{new Date(r.created_at).toLocaleDateString()}</span></li>)}</ul>
            </>
          )}
          <p className="muted">{token ? <>To invite {profile.display_name}, open one of your projects and use <a className="link" href="/client/projects">Find freelancers</a>.</> : <><a className="link" href="/#signin">Sign in</a> to invite freelancers to your projects.</>}</p>
        </article>
      ) : (
        <>
          <form className="row" role="search" onSubmit={search}>
            <div className="field" style={{ flex: 1 }}><label htmlFor="fl-q">Search by name, skill or service</label><input id="fl-q" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} /></div>
            <button className="btn primary" type="submit" disabled={loading}>Search</button>
          </form>
          {dir && !dir.open && <p className="card muted">The freelancer directory opens with the client marketplace.</p>}
          {dir && dir.open && dir.items.length === 0 && <p className="empty">No freelancers match yet.</p>}
          {!dir && loading && <p className="muted">Loading freelancers…</p>}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
            {dir?.items.map((c) => (
              <article className="card" key={c.user_id}>
                <div className="row between"><b>{c.display_name}{c.verified && <span className="badge" title="Staff reviewed this freelancer's public work evidence. Not an identity check."> Reviewed</span>}</b>{c.rating && <span className="muted small">★ {c.rating.average} ({c.rating.count})</span>}</div>
                <p className="muted small">{c.headline || 'No headline yet'}</p>
                <div className="chips">{c.skills.slice(0, 5).map((s) => <span className="chip" key={s}>{s}</span>)}</div>
                <p className="muted small">{rate(c)} · {c.completed_contracts} completed here{c.newcomer ? ' · new' : ''}</p>
                <button className="btn" type="button" onClick={() => show(c.user_id)}>View profile</button>
              </article>
            ))}
          </div>
          {dir?.more && <button className="btn" disabled={loading} onClick={() => { const next = offset + 24; setOffset(next); void load(query, next, true); }}>{loading ? 'Loading…' : 'Load more'}</button>}
        </>
      )}
    </main>
  );
}
