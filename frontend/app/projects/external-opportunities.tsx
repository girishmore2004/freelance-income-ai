'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { safeHref } from '@/lib/safe-url';

/**
 * External opportunities inside the one "Find work" page (spec §4). Jobs found
 * on approved public sources are always labelled with their source and link
 * to the original post: applying happens there. Drafting a proposal creates a
 * draft for your review on the Proposals page; nothing is sent automatically.
 */

type Notes = { matched_skills?: string[]; missing_skills?: string[]; eligibility_warnings?: string[]; job_location?: string };
export type Opportunity = {
  id: string; title: string; description: string; client_name: string; source: string; source_url: string; status: string;
  match_score: number; currency: string; job_type?: string; score_breakdown?: { notes?: Notes }; created_at?: string; last_seen_at?: string | null;
};

const SOURCES: Record<string, string> = {
  freelancer: 'Freelancer.com', hackernews: 'Hacker News', reddit: 'Reddit r/forhire', remotive: 'Remotive', jobicy: 'Jobicy',
  remoteok: 'RemoteOK', himalayas: 'Himalayas', manual: 'Added by you',
};
const STATUS: Record<string, string> = { new: 'New', drafted: 'Draft ready', ready: 'Approved', applied: 'Applied', replied: 'Replied', interview: 'Interview', offer: 'Offer', won: 'Won', lost: 'Lost', withdrawn: 'Withdrawn', skipped: 'Skipped' };

export const sourceName = (s: string) => SOURCES[s] ?? s;

function freshness(o: Opportunity): string {
  const seen = o.last_seen_at ?? o.created_at;
  if (!seen) return '';
  const days = Math.floor((Date.now() - Date.parse(seen)) / 86_400_000);
  if (Number.isNaN(days)) return '';
  return days <= 0 ? 'seen today' : days === 1 ? 'seen yesterday' : `last seen ${days} days ago`;
}

export function ExternalOpportunities({ query }: { query: string }) {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skills, setSkills] = useState('');

  const load = useCallback(async () => {
    try {
      const [rows, status] = await Promise.all([
        api<Opportunity[]>('/api/v1/opportunities'),
        api<{ last_run_at?: string | null }>('/api/v1/discovery/status').catch(() => null),
      ]);
      setItems(Array.isArray(rows) ? rows : []);
      setLastRun(status && typeof status.last_run_at === 'string' ? status.last_run_at : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load external opportunities.');
      setItems([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const searchSources = () => run(async () => {
    const r = await api<{ ran: boolean; reason?: string; searched_for?: string; new_matches?: number; sources?: Array<{ name: string; error?: string }> }>('/api/v1/discovery/run', 'POST', {});
    if (!r || !r.ran) return r?.reason ?? 'Search skipped.';
    const d = await api<{ drafted?: number }>('/api/v1/discovery/draft', 'POST', {}).catch(() => ({ drafted: 0 }));
    const failed = (r.sources ?? []).filter((s) => s.error).map((s) => s.name).join(', ');
    return `Searched for "${r.searched_for ?? ''}": ${r.new_matches ?? 0} new matches, ${d.drafted ?? 0} draft(s) ready to review.${failed ? ` (${failed} did not answer this time.)` : ''}`;
  });

  const q = query.trim().toLowerCase();
  const visible = (items ?? [])
    .filter((o) => !['skipped', 'lost', 'withdrawn'].includes(o.status))
    .filter((o) => !q || `${o.title} ${o.description} ${o.client_name}`.toLowerCase().includes(q))
    .sort((a, b) => b.match_score - a.match_score);

  return (
    <section aria-labelledby="external-heading">
      <div className="row between">
        <h3 id="external-heading">External opportunities</h3>
        <span className="row">
          {lastRun && <span className="muted small">Sources last searched {new Date(lastRun).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          <button className="btn primary" type="button" disabled={busy} onClick={() => void searchSources()}>{busy ? 'Searching…' : 'Search sources now'}</button>
          <button className="btn" type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>Add a job post</button>
        </span>
      </div>
      <p className="muted small">Found on approved public job sources and scored against your profile. You apply on the original site; drafts wait for your approval.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {adding && (
        <div className="card">
          <div className="field"><label htmlFor="ext-title">Title</label><input id="ext-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
          <div className="field"><label htmlFor="ext-desc">Description</label><textarea id="ext-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="field"><label htmlFor="ext-skills">Required skills (comma separated, optional)</label><input id="ext-skills" value={skills} onChange={(e) => setSkills(e.target.value)} /></div>
          <button className="btn primary" type="button" disabled={busy || !title.trim() || description.trim().length < 10} onClick={() => void run(async () => {
            const saved = await api<{ match_score?: number }>('/api/v1/opportunities', 'POST', { title, description, required_skills: skills.split(',').map((s) => s.trim()).filter(Boolean) });
            setTitle(''); setDescription(''); setSkills(''); setAdding(false);
            return `Saved. Match score: ${saved?.match_score ?? '—'}/100.`;
          })}>Save job post</button>
        </div>
      )}
      {items === null && <p className="muted">Loading external opportunities…</p>}
      {items !== null && visible.length === 0 && <p className="empty">No external matches{q ? ' for this search' : ' yet'}. Add skills to your profile, then search sources.</p>}
      {visible.map((o) => {
        const n = o.score_breakdown?.notes ?? {};
        return (
          <article className="card item" key={o.id}>
            <div className="row between">
              <b>{o.title}</b>
              <span className="row" style={{ gap: 6 }}>
                <span className="badge external">External · {sourceName(o.source)}</span>
                <span className={`score ${o.match_score >= 70 ? 'hi' : o.match_score >= 50 ? 'mid' : 'lo'}`} title="Match score from your profile">{o.match_score}<small>/100</small></span>
              </span>
            </div>
            <p className="muted">{o.client_name || 'Client not named'} · {o.job_type && o.job_type !== 'unknown' ? o.job_type.replace('_', ' ') : 'type not stated'} · {n.job_location || 'location not stated'}{freshness(o) ? ` · ${freshness(o)}` : ''}</p>
            <div className="chips">
              <span className={`badge s-${o.status}`}>{STATUS[o.status] ?? o.status}</span>
              {(n.matched_skills ?? []).map((k) => <span key={k} className="chip ok">{k}</span>)}
              {(n.missing_skills ?? []).slice(0, 6).map((k) => <span key={k} className="chip">{k}</span>)}
            </div>
            <p>{o.description.slice(0, 350)}{o.description.length > 350 ? '…' : ''}</p>
            {(n.eligibility_warnings ?? []).length > 0 && <p className="error">Check first: {n.eligibility_warnings!.join('; ')}</p>}
            <div className="row">
              <a className="btn" href={`/opportunities?id=${encodeURIComponent(o.id)}`}>Analyse and track</a>
              {safeHref(o.source_url) !== '#' && <a className="btn" href={safeHref(o.source_url)} target="_blank" rel="noopener noreferrer nofollow">Open original post ↗</a>}
              {o.status === 'new' && (
                <button className="btn primary" type="button" disabled={busy} onClick={() => void run(async () => {
                  await api('/api/v1/proposals/generate', 'POST', { opportunity_id: o.id, currency: o.currency });
                  return 'Draft created. Review every claim on the Proposals page before approving it.';
                })}>Draft proposal</button>
              )}
              {o.status === 'drafted' && <a className="btn primary" href="/?tab=proposals">Review draft</a>}
              {['ready', 'applied', 'replied'].includes(o.status) && <a className="btn primary" href="/?tab=pipeline">Track application</a>}
              {['new', 'drafted'].includes(o.status) && (
                <button className="btn" type="button" disabled={busy} onClick={() => void run(async () => {
                  await api(`/api/v1/opportunities/${o.id}/status`, 'POST', { status: 'skipped' });
                  return 'Skipped.';
                })}>Not interested</button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
