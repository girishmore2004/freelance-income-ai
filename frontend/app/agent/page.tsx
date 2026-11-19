'use client';
import { useMode, onSide } from '@/lib/mode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, useSessionToken } from '@/lib/api-client';

/** Action planner: one prioritised, evidence-linked queue built from your records. Read-only. */

type Action = { priority: number; category: string; title: string; reason: string; evidence: { type: string; id: string }; suggested_action: string; due_date: string | null; requires_human_approval: boolean; href?: string; side?: 'freelancer' | 'client' | null };
type Plan = { as_of_date: string; actions: Action[]; total_actionable_records: number; returned_actions: number; policy: string };

const LABELS: Record<string, string> = { pipeline: 'Pipeline', delivery: 'Delivery', approval: 'Approvals', communication: 'Communication', finance: 'Finance' };

export default function AgentPlanPage() {
  const mode = useMode();
  const [token] = useSessionToken();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<Plan>('/api/v1/agent/action-plan?limit=50');
      setPlan(result && Array.isArray(result.actions) ? result : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the action plan.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of plan?.actions ?? []) out[a.category] = (out[a.category] ?? 0) + 1;
    return out;
  }, [plan]);
  // Only the active side's actions (the server tags each action's side; older replies fall back to the page it opens).
  const visible = (plan?.actions ?? []).filter((a) => filter === 'all' || a.category === filter).filter((a) => onSide(a, mode));

  if (!token) return <main className="shell"><p>Sign in first to see your action plan.</p><a className="btn" href="/">Back to dashboard</a></main>;
  return (
    <main className="shell">
      <header className="top">
        <div><div className="brand">Action plan</div><div className="muted">What to do next across offers, deliveries, reviews and older records</div></div>
        <nav className="row"><a className="btn" href="/workspace">Workspace</a><a className="btn" href="/contracts">Contracts</a>{mode === 'freelancer' && <a className="btn" href="/coach">AI coach</a>}</nav>
      </header>
      <section className="card">
        <div className="row between">
          <div><h2>Recommended next actions</h2><p className="muted">As of {plan?.as_of_date ?? '—'} · {plan?.total_actionable_records ?? '—'} open items</p></div>
          <button className="btn" disabled={busy} onClick={() => void load()}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {plan && (
          <>
            <div className="grid">{Object.entries(LABELS).map(([key, label]) => <article className="card" key={key}><small className="muted">{label}</small><h2>{counts[key] ?? 0}</h2></article>)}</div>
            <div className="field">
              <label htmlFor="plan-filter">Show</label>
              <select id="plan-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All categories</option>
                {Object.entries(LABELS).filter(([k]) => counts[k]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            {visible.length === 0 ? <p className="empty">Nothing to do here right now.</p> : visible.map((a, i) => (
              <article className="item" key={`${a.evidence.type}:${a.evidence.id}:${i}`}>
                <div className="row between"><span className="muted">#{i + 1} · {a.priority === 1 ? 'High' : a.priority === 2 ? 'Medium' : 'Low'} priority · {LABELS[a.category] ?? a.category}</span>{a.due_date && <span className="muted">Due {a.due_date}</span>}</div>
                <h3>{a.title}</h3>
                <p>{a.reason}</p>
                <p><b>Next step:</b> {a.suggested_action}</p>
                {a.href && <a className="btn" href={a.href}>Open</a>}
              </article>
            ))}
          </>
        )}
      </section>
      <p className="muted">{plan?.policy ?? 'Recommendations only. Nothing is executed automatically.'}</p>
    </main>
  );
}
