'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useSessionToken } from '@/lib/api-client';

/**
 * AI agents (Phase 6): the governed catalogue from Master Plan v2 with each
 * agent's autonomy ceiling, human gate and honest build status, plus your
 * recent agent runs. Admins can switch an agent off (its AI calls then fall
 * back to templates).
 */

type Agent = { code: string; name: string; side: string; purpose: string; autonomy_ceiling: string; human_gate: string; tools: string[]; status: string; enabled: boolean };
type Run = { id: string; agent_code: string | null; agent_name: string; status: string; summary: string; created_at: string };

const SIDES: Array<[string, string]> = [['freelancer', 'For freelancers'], ['client', 'For clients'], ['platform', 'Platform operations (prepare evidence; staff decide)']];
const STATUS: Record<string, string> = { live: 'Live', partial: 'Partly built', planned: 'Planned', blocked: 'Blocked (needs payments)' };
type Usage = { runs: number; failed: number; last_run_at: string | null; ai_calls_today: number; ai_calls_month: number };
type UsageReply = { agents: Record<string, Usage>; pending_approvals: number };

/** Where each built agent does its work in the product (no separate chat for agents that act on a page). */
const WHERE: Record<string, { href: string; label: string }> = {
  F1: { href: '/projects?view=external', label: 'Find work (external search)' },
  F2: { href: '/projects', label: 'Find work (match scores and reasons)' },
  F4: { href: '/projects?view=external', label: 'Draft a proposal from an opportunity' },
  F9: { href: '/?tab=replies', label: 'Client replies' },
  F11: { href: '/coach', label: 'Ask the business coach' },
  C1: { href: '/client/projects', label: 'Post a project with the Brief Builder' },
  C2: { href: '/client/projects', label: 'Find freelancers for a project' },
  C3: { href: '/client/projects', label: 'Compare proposals' },
  C5: { href: '/client/projects', label: 'Make an offer (suggested milestones)' },
  C6: { href: '/contracts', label: 'Review a delivery (acceptance checklist)' },
  P1: { href: '/admin', label: 'Moderation queue (staff)' },
  P8: { href: '/admin', label: 'Disputes and evidence packs (staff)' },
};

const LEVELS: Record<string, string> = { A0: 'Observe', A1: 'Recommend', A2: 'Draft for your review', A3: 'Act after confirmation', A4: 'Bounded automation' };

export default function AiAgentsPage() {
  const [token] = useSessionToken();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageReply | null>(null);
  const [agentRuns, setAgentRuns] = useState<Record<string, Run[]>>({});

  const load = useCallback(async () => {
    try {
      const [a, r, me] = await Promise.all([
        api<Agent[]>('/api/v1/agents'),
        api<Run[]>('/api/v1/me/agent-runs'),
        api<{ roles?: string[] }>('/api/v1/me'),
      ]);
      setAgents(Array.isArray(a) ? a : []);
      setRuns(Array.isArray(r) ? r : []);
      setIsAdmin(Array.isArray(me?.roles) && me.roles.includes('admin'));
      api<UsageReply>('/api/v1/me/agent-usage').then((u) => setUsage(u && typeof u.agents === 'object' ? u : null)).catch(() => setUsage(null));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load agents.');
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function openRuns(code: string) {
    if (agentRuns[code]) return;
    try {
      const rows = await api<Run[]>(`/api/v1/me/agent-runs?agent=${encodeURIComponent(code)}`);
      setAgentRuns((m) => ({ ...m, [code]: Array.isArray(rows) ? rows : [] }));
    } catch {
      setAgentRuns((m) => ({ ...m, [code]: [] }));
    }
  }

  async function toggle(agent: Agent) {
    setBusy(true);
    setNotice('');
    try {
      const result = await api<Agent & { message?: string }>(`/api/v1/admin/agents/${agent.code}`, 'POST', { enabled: !agent.enabled });
      setNotice(result.message ?? 'Updated');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the agent.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <main className="shell"><div className="card"><h2>AI agents</h2><p className="muted">Sign in first to see the AI agents and your agent activity.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  return (
    <main className="shell">
      <div className="row between"><h2>AI agent centre</h2></div>
      <p className="muted">Agents prepare, explain and draft. Anything that sends, publishes, accepts or moves money needs a person’s explicit approval. Payments are never decided by an agent.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {usage && (
        <section className="grid" aria-label="Agent overview" style={{ marginBottom: 14 }}>
          <article className="card"><small className="muted">Agents available</small><div className="metric">{agents.filter((a) => a.enabled && ['live', 'partial'].includes(a.status)).length}</div></article>
          <article className="card"><small className="muted">My agent runs</small><div className="metric">{Object.values(usage.agents).reduce((n, u) => n + u.runs, 0)}</div></article>
          <article className="card"><small className="muted">Failed runs</small><div className="metric">{Object.values(usage.agents).reduce((n, u) => n + u.failed, 0)}</div></article>
          <article className="card"><small className="muted">AI calls today</small><div className="metric">{Object.values(usage.agents).reduce((n, u) => n + u.ai_calls_today, 0)}</div></article>
          <article className="card"><small className="muted">Drafts waiting for my approval</small><div className="metric">{usage.pending_approvals}</div>{usage.pending_approvals > 0 && <a className="link" href="/?tab=approvals">Review</a>}</article>
        </section>
      )}

      {SIDES.map(([side, title]) => {
        const group = agents.filter((a) => a.side === side);
        if (!group.length) return null;
        return (
          <section key={side} className="card" aria-labelledby={`side-${side}`}>
            <h3 id={`side-${side}`}>{title}</h3>
            {group.map((a) => (
              <div className="item" key={a.code}>
                <div className="row between">
                  <b>{a.code} · {a.name}</b>
                  <span className="badge">{STATUS[a.status] ?? a.status}{a.enabled ? '' : ' · switched off'}</span>
                </div>
                <p>{a.purpose}</p>
                <p className="muted">Autonomy: {a.autonomy_ceiling} ({LEVELS[a.autonomy_ceiling] ?? a.autonomy_ceiling}) · Human gate: {a.human_gate}</p>
                {usage?.agents[a.code] && (
                  <p className="muted small">Your use: {usage.agents[a.code].runs} run{usage.agents[a.code].runs === 1 ? '' : 's'}{usage.agents[a.code].failed ? ` (${usage.agents[a.code].failed} failed)` : ''} · AI calls {usage.agents[a.code].ai_calls_today} today, {usage.agents[a.code].ai_calls_month} this month</p>
                )}
                <div className="row">
                  {a.enabled && ['live', 'partial'].includes(a.status) && WHERE[a.code] && <a className="btn primary" href={WHERE[a.code].href}>Open: {WHERE[a.code].label}</a>}
                  <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void openRuns(a.code); }}>
                    <summary>Details and history</summary>
                    {a.tools.length > 0 && <p className="muted small">Tools it may use: {a.tools.join(', ')}</p>}
                    {(agentRuns[a.code] ?? []).length === 0 ? <p className="muted small">{agentRuns[a.code] ? 'No runs for you yet.' : 'Loading…'}</p> : (
                      <ul>{agentRuns[a.code].map((r) => <li key={r.id} className="small">{r.status} · {r.summary} <span className="muted">{new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></li>)}</ul>
                    )}
                  </details>
                </div>
                {isAdmin && ['live', 'partial'].includes(a.status) && (
                  <button className="btn" disabled={busy} onClick={() => void toggle(a)}>{a.enabled ? 'Switch off' : 'Switch on'}</button>
                )}
              </div>
            ))}
          </section>
        );
      })}

      <section className="card" aria-labelledby="runs-heading">
        <h3 id="runs-heading">Your recent agent activity</h3>
        {runs.length === 0 ? <p className="empty">No agent runs yet.</p> : (
          <ul>{runs.map((r) => <li key={r.id}><b>{r.agent_code ?? r.agent_name}</b> · {r.status} · {r.summary} <span className="muted">{new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></li>)}</ul>
        )}
      </section>
    </main>
  );
}
