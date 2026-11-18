'use client';
import { useMode } from '@/lib/mode';
import { useCallback, useEffect, useState } from 'react';
import { api, useSessionToken } from '@/lib/api-client';
import { TYPE_LABELS, groupByDay, shiftDays, type CalendarEvent } from '@/lib/calendar';

/**
 * Calendar (spec §3): dated items from your own records — milestones due on
 * your contracts (as freelancer or client), saved projects that close or have
 * a deadline, and your posted projects. Nothing here is stored separately;
 * fix a date where it lives (contract terms, project brief).
 */

const DAYS = 42;
type Filter = 'freelancer' | 'client';

export default function CalendarPage() {
  const [token] = useSessionToken();
  const [from, setFrom] = useState<string | null>(null);
  const [data, setData] = useState<{ from: string; to: string; today: string; events: CalendarEvent[] } | null>(null);
  const mode = useMode();
  // One side at a time: the Freelancer / Client switch decides which dates show.
  const filter: Filter = mode;
  const [error, setError] = useState('');

  const load = useCallback(async (start: string | null) => {
    setError('');
    try {
      const params = new URLSearchParams({ days: String(DAYS), ...(start ? { from: start } : {}) });
      const r = await api<{ from: string; to: string; today: string; events: CalendarEvent[] }>(`/api/v1/me/calendar?${params.toString()}`);
      if (r && Array.isArray(r.events)) setData(r);
      else setError('Could not load your calendar.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your calendar.');
    }
  }, []);

  useEffect(() => { if (token) void load(from); }, [token, from, load]);

  if (!token) return <main className="shell"><div className="card"><h2>Calendar</h2><p className="muted">Sign in first to see your dates.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  const events = (data?.events ?? []).filter((e) => e.side === filter);
  const groups = data ? groupByDay(events, data.today) : [];
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <main className="shell">
      <h2>Calendar</h2>
      <p className="muted">Milestones, closing dates and deadlines from your contracts, saved projects and posted projects.</p>
      <div className="row between">
        <div className="row">
          <button className="btn" type="button" disabled={!data} onClick={() => data && setFrom(shiftDays(data.from, -DAYS))}>Earlier</button>
          <button className="btn" type="button" disabled={!data || from === null} onClick={() => setFrom(null)}>From today</button>
          <button className="btn" type="button" disabled={!data} onClick={() => data && setFrom(shiftDays(data.from, DAYS))}>Later</button>
          {data && <span className="muted">{fmt(data.from)} – {fmt(data.to)}</span>}
        </div>
        <span className="badge">{mode === 'client' ? 'Hiring dates' : 'Freelance work dates'}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && groups.length === 0 && <p className="empty">Nothing dated in this period. Milestone due dates come from contract terms; save projects on Find work to track their closing dates.</p>}
      {groups.map((g) => (
        <section className="card" key={g.key} aria-label={g.label}>
          <h3 className={g.key === 'overdue' ? 'error' : undefined} style={{ marginTop: 0 }}>{g.label}</h3>
          <ul>
            {g.events.map((e, i) => (
              <li key={`${e.type}-${e.title}-${i}`}>
                <span className={`badge${e.overdue ? ' s-lost' : ''}`}>{TYPE_LABELS[e.type] ?? e.type}</span>{' '}
                <a className="link" href={e.href}>{e.title}</a>
                <span className="muted"> — {e.detail}{g.key === 'overdue' ? ` (was due ${fmt(e.date)})` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
