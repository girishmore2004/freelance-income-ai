'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useSessionToken } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/**
 * Business workspace: one view across marketplace work (contracts, deliveries,
 * earnings) and older records (opportunities, drafts, invoices, tasks), with
 * goals and deterministic recommendations. Everything comes from the
 * signed-in person's own records; a dash means that kind of record is not
 * available.
 */

type Goals = { monthly_income_target: number; weekly_hours_target: number; monthly_proposals_target: number; monthly_outreach_target: number; currency: string };
type Metrics = Record<string, number | null | Record<string, number>>;
type Alert = { id: string; severity: string; title: string; action: string; href: string };
type Rec = { priority: string; title: string; reason: string; action: string; evidence: { type: string; value: number }[] };
type ApplyNext = { external: Array<{ id: string; title: string; source: string; match_score: number; source_url: string }>; invitations: Array<{ listing_id: string; title: string }> };
type Deadline = { contract_id: string; title: string; milestone: number; milestone_title: string; due_date: string; overdue: boolean; side: string };
type Pending = { mode: string; amount_minor: number; milestones: number };
type Overview = { as_of: string; metrics: Metrics; goals: Goals; alerts: Alert[]; recommendations: Rec[]; data_policy: string; apply_next?: ApplyNext; deadlines?: Deadline[]; pending_release?: Pending[] };
type Event = { id: string; event_type: string; detail: string; created_at: string };

const CARDS: Array<[string, string]> = [
  ['active_contracts_as_freelancer', 'Active contracts (freelancer)'], ['deliveries_awaiting_client', 'Deliveries waiting for clients'],
  ['active_contracts_as_client', 'Active contracts (client)'], ['deliveries_to_review', 'Deliveries for you to review'],
  ['month_proposals', 'Proposals this month'], ['pending_proposal_approvals', 'Proposal drafts to approve'],
  ['open_opportunities', 'Open opportunities'], ['overdue_invoices', 'Overdue invoices'], ['overdue_tasks', 'Overdue tasks'],
];

export default function WorkspacePage() {
  const [token] = useSessionToken();
  const [data, setData] = useState<Overview | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [goal, setGoal] = useState<Goals>({ monthly_income_target: 0, weekly_hours_target: 10, monthly_proposals_target: 4, monthly_outreach_target: 10, currency: 'INR' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [overview, goals, ev] = await Promise.all([
        api<Overview>('/api/v1/workspace/overview'),
        api<Goals>('/api/v1/business-goals'),
        api<Event[]>('/api/v1/workspace/events'),
      ]);
      setData(overview && overview.metrics ? overview : null);
      if (goals && typeof goals.monthly_income_target === 'number') setGoal(goals);
      setEvents(Array.isArray(ev) ? ev : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the workspace.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { monthly_income_target, weekly_hours_target, monthly_proposals_target, monthly_outreach_target, currency } = goal;
      await api('/api/v1/business-goals', 'PUT', { monthly_income_target, weekly_hours_target, monthly_proposals_target, monthly_outreach_target, currency });
      setNotice('Business goals saved.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save goals.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <main className="shell"><p>Sign in first, then open the business workspace.</p><a className="btn" href="/">Back to dashboard</a></main>;
  const m = data?.metrics ?? {};
  const num = (k: string) => (typeof m[k] === 'number' ? (m[k] as number) : m[k] === null ? '—' : '…');
  const released = (m.released_this_month_minor ?? {}) as Record<string, number>;
  const paid = (m.paid_this_month_by_currency ?? {}) as Record<string, number>;
  const setNum = (key: keyof Goals) => (e: { target: { value: string } }) => setGoal({ ...goal, [key]: Number(e.target.value) });

  return (
    <main className="shell">
      <header className="top">
        <div><div className="brand">Business workspace</div><div className="muted">One view across finding work, contracts, delivery and earnings</div></div>
        <nav className="row"><a className="btn" href="/agent">Action plan</a><a className="btn" href="/coach">AI coach</a><a className="btn" href="/">Dashboard</a></nav>
      </header>
      <p className="muted">As of {data?.as_of ?? '—'} · <button className="btn" disabled={busy} onClick={() => void load()}>{busy ? 'Refreshing…' : 'Refresh'}</button></p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>

      <section className="grid" aria-label="Metrics">
        {CARDS.map(([key, label]) => <article className="card" key={key}><small className="muted">{label}</small><h2>{num(key)}</h2></article>)}
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', marginTop: 14 }}>
        <section className="card" aria-labelledby="apply-heading">
          <h2 id="apply-heading">Apply next</h2>
          {(data?.apply_next?.invitations ?? []).map((i) => <p key={i.listing_id}><span className="badge native">Invitation</span> <a className="link" href="/projects">{i.title}</a></p>)}
          {(data?.apply_next?.external ?? []).map((o) => <p key={o.id}><span className="badge external">External</span> <a className="link" href="/projects?view=external">{o.title}</a> <span className="muted small">{o.match_score}/100</span></p>)}
          {(data?.apply_next?.invitations ?? []).length + (data?.apply_next?.external ?? []).length === 0 && <p className="muted">No new matches or invitations. <a className="link" href="/projects">Find work</a></p>}
        </section>
        <section className="card" aria-labelledby="deadline-heading">
          <h2 id="deadline-heading">Upcoming deadlines</h2>
          {(data?.deadlines ?? []).length === 0 ? <p className="muted">No milestone due in the next two weeks.</p> : (
            <ul>{(data?.deadlines ?? []).map((d) => <li key={`${d.contract_id}:${d.milestone}`}><a className="link" href={`/contracts#${d.contract_id}`}>{d.title}</a> — {d.milestone_title} · <span className={d.overdue ? 'error' : 'muted'}>{d.overdue ? 'overdue since' : 'due'} {d.due_date}</span></li>)}</ul>
          )}
        </section>
        <section className="card" aria-labelledby="pending-heading">
          <h2 id="pending-heading">Waiting for release</h2>
          {(data?.pending_release ?? []).length === 0 ? <p className="muted">No funded milestones waiting for approval.</p> : (data?.pending_release ?? []).map((p) => (
            <p key={p.mode}>{formatMinor(p.amount_minor, 'INR')} across {p.milestones} funded milestone{p.milestones === 1 ? '' : 's'}{p.mode === 'sandbox' ? ' (test mode)' : ''} — released when the client approves.</p>
          ))}
        </section>
      </div>

      <section className="card">
        <h2>Earnings this month</h2>
        {Object.keys(released).length === 0 && Object.keys(paid).length === 0 && <p className="muted">No released payments or paid invoices recorded this month.</p>}
        {Object.entries(released).map(([mode, minor]) => <p key={mode}>Released to you on the marketplace: {formatMinor(minor, 'INR')}{mode === 'sandbox' ? ' (test mode — not real money)' : ''}</p>)}
        {Object.entries(paid).map(([currency, amount]) => <p key={currency}>Invoices marked paid: {currency} {amount.toLocaleString('en-IN')}</p>)}
        <p className="muted">Proposals this month: {num('month_proposals')} / target {goal.monthly_proposals_target}</p>
      </section>

      <section className="card">
        <h2>Needs attention</h2>
        {(data?.alerts ?? []).length === 0 ? <p className="muted">Nothing urgent in your records.</p> : (data?.alerts ?? []).map((a) => (
          <article className="item" key={a.id}><b>{a.title}</b><p>{a.action}</p><span className="muted">{a.severity === 'high' ? 'High priority' : 'Medium priority'}</span> {a.href && <a className="link" href={a.href}>Open</a>}</article>
        ))}
      </section>

      <section className="card">
        <h2>Recommendations</h2>
        <p className="muted">Rules applied to your saved records — not AI guesses.</p>
        {(data?.recommendations ?? []).map((r, i) => (
          <article className="item" key={i}><b>{r.title}</b><p>{r.reason}</p><p>{r.action}</p><small className="muted">Priority: {r.priority} · Evidence: {r.evidence.map((e) => `${e.type.replace(/_/g, ' ')} = ${e.value}`).join(', ')}</small></article>
        ))}
      </section>

      <section className="card" aria-labelledby="goals-heading">
        <h2 id="goals-heading">Business goals</h2>
        <p className="muted">Targets used for planning. They are goals, not predictions.</p>
        <div className="grid">
          <div className="field"><label htmlFor="g-income">Monthly income target</label><input id="g-income" type="number" min="0" value={goal.monthly_income_target} onChange={setNum('monthly_income_target')} /></div>
          <div className="field"><label htmlFor="g-currency">Currency</label><input id="g-currency" maxLength={8} value={goal.currency} onChange={(e) => setGoal({ ...goal, currency: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label htmlFor="g-hours">Weekly work hours</label><input id="g-hours" type="number" min="0" max="168" value={goal.weekly_hours_target} onChange={setNum('weekly_hours_target')} /></div>
          <div className="field"><label htmlFor="g-proposals">Monthly proposal target</label><input id="g-proposals" type="number" min="0" value={goal.monthly_proposals_target} onChange={setNum('monthly_proposals_target')} /></div>
          <div className="field"><label htmlFor="g-outreach">Monthly outreach target</label><input id="g-outreach" type="number" min="0" value={goal.monthly_outreach_target} onChange={setNum('monthly_outreach_target')} /></div>
        </div>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>Save goals</button>
      </section>

      <section className="card">
        <h2>Workspace history</h2>
        {events.length === 0 ? <p className="muted">No workspace events yet.</p> : events.map((e) => <p className="item" key={e.id}>{e.detail || e.event_type} · {new Date(e.created_at).toLocaleString()}</p>)}
      </section>
      <p className="muted">{data?.data_policy}</p>
      <footer className="muted">Nothing here sends messages, submits proposals, delivers files or moves money.</footer>
    </main>
  );
}
