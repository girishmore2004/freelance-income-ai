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
const LEVELS: Record<string, string> = { A0: 'Observe', A1: 'Recommend', A2: 'Draft for your review', A3: 'Act after confirmation', A4: 'Bounded automation' };

export default function AiAgentsPage() {
  const [token] = useSessionToken();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load agents.');
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

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
      <div className="row between"><h2>AI agents</h2><a className="link" href="/">← Back to workspace</a></div>
      <p className="muted">Agents prepare, explain and draft. Anything that sends, publishes, accepts or moves money needs a person’s explicit approval. Payments are never decided by an agent.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>

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
