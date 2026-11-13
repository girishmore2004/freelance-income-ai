'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
type Run = {
  id: string; workflow_type: string; status: string; current_step: string;
  attempt_count: number; max_attempts: number; error?: string; error_code?: string; last_error_node?: string;
  result?: {
    action_plan?: Array<{priority:number;category:string;title:string;reason:string;suggested_action:string;evidence:{type:string;id:string};requires_human_approval:boolean}>;
    agent_trace?: Array<{agent:string;status:string;duration_ms?:number}>;
    matching?: {ranked_opportunities?:Array<{title:string;score:number}>};
    finance?:{paid_total?:number;outstanding_total?:number};
    delivery?:{open_task_count?:number;active_project_count?:number};
    proposal_strategy?:{draft_count?:number;drafts?:Array<{opportunity_id:string;title:string;match_score:number;proposed_price:number|null;client_budget_max_reference:number|null;currency:string;draft_content:string;generation_mode:string;requires_human_review:boolean;external_submission:string}>;note?:string};
    communication?:{review_count?:number;recommendations?:Array<{email_id:string;subject:string;sender:string;category:string;urgency:string;urgency_score:number;urgency_reasons:string[];follow_up:any;reply_guidance:string;portfolio_sources:Array<{type:string;label:string;chunk_id?:string}>;linked_project:any}>;policy?:string};
  };
};
export default function AgentWorkflowsPage() {
  const [token, setToken] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run|null>(null);
  const [workflowType, setWorkflowType] = useState('business_review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<any>(null);
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  async function load() {
    if (!token) return;
    const response = await fetch(`${API}/api/v1/agent-workflows`, {headers: headers()});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Unable to load agent workflows');
    setRuns(data);
    const metricsResponse = await fetch(`${API}/api/v1/agent-workflows/metrics/summary`, {headers: headers()});
    if (metricsResponse.ok) setMetrics(await metricsResponse.json());
    if (selected) {
      const detail = await fetch(`${API}/api/v1/agent-workflows/${selected.id}`, {headers: headers()});
      if (detail.ok) setSelected(await detail.json());
    }
  }
  useEffect(() => { setToken(localStorage.getItem('fia_token') || ''); }, []);
  useEffect(() => { if (token) load().catch(e => setError(e.message)); }, [token]);
  async function start() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/v1/agent-workflows`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({workflow_type: workflowType, idempotency_key: crypto.randomUUID()}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to start workflow');
      await load();
      const detail = await fetch(`${API}/api/v1/agent-workflows/${data.workflow_id}`, {headers: headers()});
      if (detail.ok) setSelected(await detail.json());
    } catch (e:any) { setError(e.message || 'Unable to start workflow'); }
    finally { setBusy(false); }
  }
  async function cancel(id:string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/v1/agent-workflows/${id}/cancel`, {method:'POST',headers:headers()});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to cancel workflow');
      await load();
    } catch (e:any) { setError(e.message || 'Unable to cancel workflow'); }
    finally { setBusy(false); }
  }
  async function retry(id:string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/v1/agent-workflows/${id}/retry`, {method:'POST',headers:headers()});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to retry workflow');
      await load();
    } catch (e:any) { setError(e.message || 'Unable to retry workflow'); }
    finally { setBusy(false); }
  }
  if (!token) return <main className="shell"><p>Sign in first to use agent workflows.</p><a href="/">Back to dashboard</a></main>;
  return <main className="shell">
    <header className="top"><div><div className="brand">Multi-Agent Workflows</div><div className="muted">Durable, resumable analysis across your freelance business</div></div>
      <nav className="row"><a className="btn" href="/workspace">Workspace</a><a className="btn" href="/agent">Action Planner</a><a className="btn" href="/coach">AI Coach</a></nav>
    </header>
    <section className="card">
      <h2>Start an analysis workflow</h2>
      <p className="muted">Specialists inspect opportunities, client evidence, projects, invoices, recent client emails and portfolio documents. Proposal drafts and communication plans are review-only; nothing is sent or submitted.</p>
      <div className="row">
        <select value={workflowType} onChange={e=>setWorkflowType(e.target.value)} className="input">
          <option value="business_review">Complete business review</option>
          <option value="opportunity_plan">Opportunity planning</option>
          <option value="delivery_review">Delivery review</option>
          <option value="finance_review">Finance review</option>
        </select>
        <button className="btn" onClick={start} disabled={busy}>{busy?'Working…':'Run multi-agent analysis'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="card">
      <div className="row"><h2>Workflow history</h2><button className="btn" onClick={()=>load().catch(e=>setError(e.message))}>Refresh</button></div>
      {metrics && <p className="muted">Last {metrics.total} runs · {Object.entries(metrics.status_counts||{}).map(([k,v])=>`${k}: ${v}`).join(' · ')} · Mean measured agent step: {metrics.mean_agent_duration_ms ?? '—'} ms</p>}
      {runs.length===0 && <p className="muted">No multi-agent workflows yet.</p>}
      {runs.map(run=><article className="item" key={run.id}>
        <div className="row"><b>{run.workflow_type.replaceAll('_',' ')}</b><span className="muted">{run.status} · {run.current_step} · attempts {run.attempt_count}/{run.max_attempts}</span></div>
        <small className="muted">{run.id}</small>
        <div className="row"><button className="btn" onClick={async()=>{const r=await fetch(`${API}/api/v1/agent-workflows/${run.id}`,{headers:headers()});if(r.ok)setSelected(await r.json())}}>View details</button>
        {run.status==='failed' && run.attempt_count<run.max_attempts && <button className="btn" disabled={busy} onClick={()=>retry(run.id)}>Retry from checkpoint</button>}
        {(run.status==='queued'||run.status==='running') && <button className="btn" disabled={busy} onClick={()=>cancel(run.id)}>Cancel</button>}</div>
        {run.error && <p className="error">{run.error_code ? `${run.error_code}: ` : ''}{run.last_error_node ? `at ${run.last_error_node} — ` : ''}{run.error}</p>}
      </article>)}
    </section>
    {selected && <section className="card">
      <div className="row"><h2>Workflow result</h2><button className="btn" onClick={()=>setSelected(null)}>Close</button></div>
      <p className="muted">{selected.status} · {selected.current_step}</p>
      <h3>Specialist execution trace</h3>
      {(selected.result?.agent_trace||[]).map((x,i)=><p key={i}>{x.agent} — {x.status}{x.duration_ms !== undefined ? ` · ${x.duration_ms} ms` : ''}</p>)}
      <h3>Recommended next actions</h3>
      {(selected.result?.action_plan||[]).map((x,i)=><article className="item" key={`${x.evidence.type}:${x.evidence.id}`}><b>#{i+1} · {x.category} · Priority {x.priority}</b><h4>{x.title}</h4><p>{x.reason}</p><p><b>Suggested:</b> {x.suggested_action}</p><small className="muted">Evidence: {x.evidence.type} / {x.evidence.id} · Human decision required</small></article>)}
      <h3>Proposal strategist</h3>
      <p className="muted">{selected.result?.proposal_strategy?.note || 'No proposal strategy output.'}</p>
      {(selected.result?.proposal_strategy?.drafts||[]).map((draft,i)=><article className="item" key={draft.opportunity_id}>
        <div className="row"><b>{draft.title}</b><span className="muted">Match {draft.match_score}/100</span></div>
        <p className="muted">Client budget ceiling (not a quote): {draft.client_budget_max_reference ?? 'Not provided'} {draft.currency} · {draft.generation_mode}</p>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{draft.draft_content}</pre>
        <small className="muted">Draft only · Review and create an editable proposal through the existing proposal workflow. External submission not performed.</small>
      </article>)}
      <h3>Client communication planner</h3>
      <p className="muted">{selected.result?.communication?.policy || 'No communication recommendations.'}</p>
      {(selected.result?.communication?.recommendations||[]).map((item,i)=><article className="item" key={item.email_id}>
        <div className="row"><b>{item.subject || 'Client email'}</b><span className="muted">{item.urgency} urgency · {item.urgency_score}/100</span></div>
        <p>From: {item.sender} · Category: {item.category}</p>
        <p>{item.urgency_reasons.join(' · ')}</p>
        {item.follow_up && <p><b>Follow-up suggestion:</b> {item.follow_up.cadence} · {new Date(item.follow_up.due_at).toLocaleString()}</p>}
        <p><b>Reply guidance:</b> {item.reply_guidance}</p>
        {item.linked_project && <p>Linked project: {item.linked_project.title}</p>}
        {item.portfolio_sources.map((src,j)=><small className="muted" key={j}>Evidence: {src.type} · {src.label}{src.chunk_id ? ` · ${src.chunk_id}` : ''}</small>)}
        <p className="muted">Review only · Open the email workspace to generate and approve a reply. No message sent.</p>
      </article>)}
      <h3>Finance snapshot</h3><p>Paid: {selected.result?.finance?.paid_total ?? '—'} · Outstanding: {selected.result?.finance?.outstanding_total ?? '—'}</p>
      <h3>Delivery snapshot</h3><p>Active projects: {selected.result?.delivery?.active_project_count ?? '—'} · Open tasks: {selected.result?.delivery?.open_task_count ?? '—'}</p>
      <p className="muted">This workflow is read-only. It does not send messages, submit proposals, deliver work, issue invoices or move money.</p>
    </section>}
  </main>;
}
