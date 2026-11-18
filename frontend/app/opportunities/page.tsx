'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { safeHref } from '@/lib/safe-url';
import { EXTERNAL_STATUS_LABELS, transitionLabel } from '@/lib/external-pipeline';

/**
 * One external opportunity as a single record (spec §4, U8): analysis,
 * proposal versions and approvals, submissions, follow-ups and interviews,
 * status history and the outcome. Applying, the contract and payment happen
 * on the original platform; this page records what you did there.
 */

type Analysis = {
  match_score: number; matched_skills: string[]; missing_skills: string[]; budget: { status: string; detail: string };
  client: { payment_verified: boolean | null; rating: number | null; reviews: number | null }; risks: string[];
  recommendation: 'apply' | 'consider' | 'skip'; reasons: string[]; evidence: Array<{ url: string; matched: string[] }>;
};
type Version = { version: number; content: string; proposed_price: number | null; currency: string; source: string; created_at: string };
type Proposal = { id: string; version: number; content: string; status: string; proposed_price: number | null; currency: string; versions: Version[]; approvals: Array<{ id: string; decision: string; note: string; created_at: string; decided_at: string | null }> };
type Application = { id: string; channel: string; status: string; reference: string; sent_at: string | null; replies: number };
type Event = { id: string; kind: string; from_status: string | null; to_status: string | null; note: string; due_date: string | null; done_at: string | null; created_at: string };
type Timeline = {
  opportunity: { id: string; title: string; client_name: string; description: string; source: string; source_url: string; currency: string };
  analysis: Analysis; proposals: Proposal[]; applications: Application[]; events: Event[]; status: string; allowed_transitions: string[];
  next_step: { action: string; text: string }; history_available: boolean; external_notice: string;
};

const SOURCE_LABEL: Record<string, string> = { model: 'AI draft', safe_template: 'Template', edited: 'Your edit', legacy: 'Earlier text' };
const REC: Record<string, string> = { apply: 'Worth applying', consider: 'Consider carefully', skip: 'Probably skip' };
const when = (v: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function OpportunityPage() {
  const [token] = useSessionToken();
  const [id, setId] = useState('');
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState('');
  const [kind, setKind] = useState<'follow_up' | 'interview' | 'note'>('follow_up');
  const [eventNote, setEventNote] = useState('');
  const [due, setDue] = useState('');
  const [channel, setChannel] = useState('external_site');
  const [reference, setReference] = useState('');
  const [statusNote, setStatusNote] = useState('');

  useEffect(() => { setId(new URLSearchParams(window.location.search).get('id') ?? ''); }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const t = await api<Timeline>(`/api/v1/opportunities/${encodeURIComponent(id)}/timeline`);
      if (t && t.opportunity && Array.isArray(t.proposals)) {
        setData(t);
        const current = t.proposals[t.proposals.length - 1];
        setEdit(current ? current.content : '');
      } else setError('Could not load this opportunity.');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'This opportunity was not found in your records.' : e instanceof Error ? e.message : 'Could not load this opportunity.');
    }
  }, [id]);

  useEffect(() => { if (token && id) void load(); }, [token, id, load]);

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

  if (!token) return <main className="shell"><div className="card"><h2>Opportunity</h2><p className="muted">Sign in first.</p><a className="btn" href="/">Go to sign in</a></div></main>;
  if (!id) return <main className="shell"><div className="card"><p className="muted">Open an opportunity from Find work.</p><a className="btn" href="/projects?view=external">Find work</a></div></main>;

  const proposal = data?.proposals[data.proposals.length - 1];
  const pending = proposal?.approvals.find((a) => a.decision === 'pending');
  const a = data?.analysis;

  function addEvent(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/v1/opportunities/${encodeURIComponent(id)}/events`, 'POST', { kind, note: eventNote, due_date: due || null });
      setEventNote('');
      setDue('');
      return kind === 'note' ? 'Note added.' : 'Added to your calendar.';
    });
  }

  function move(to: string) {
    void run(async () => {
      const payload: Record<string, unknown> = { status: to, note: statusNote };
      if (to === 'applied') Object.assign(payload, { channel, reference });
      const r = await api<{ message?: string }>(`/api/v1/opportunities/${encodeURIComponent(id)}/status`, 'POST', payload);
      setStatusNote('');
      setReference('');
      return r?.message ?? `Marked as ${to}.`;
    });
  }

  return (
    <main className="shell">
      <p><a className="link" href="/projects?view=external">← Find work</a></p>
      {error && <p className="error" role="alert">{error}</p>}
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}</div>
      {!data && !error && <p className="muted">Loading…</p>}
      {data && a && (
        <>
          <div className="row between">
            <h2>{data.opportunity.title}</h2>
            <span className="row" style={{ gap: 6 }}>
              <span className="badge external">External · {data.opportunity.source}</span>
              <span className="badge">{EXTERNAL_STATUS_LABELS[data.status] ?? data.status}</span>
            </span>
          </div>
          <p className="muted">{data.opportunity.client_name} · {safeHref(data.opportunity.source_url) !== '#' && <a className="link" href={safeHref(data.opportunity.source_url)} target="_blank" rel="noopener noreferrer nofollow">Open original post ↗</a>}</p>
          <p className="notice" role="note">{data.external_notice}</p>
          <section className="card" aria-labelledby="next-heading">
            <h3 id="next-heading">Next step</h3>
            <p>{data.next_step.text}</p>
          </section>

          <section className="card" aria-labelledby="analysis-heading">
            <h3 id="analysis-heading">Analysis</h3>
            <p><b>{REC[a.recommendation]}</b> · match {a.match_score}/100 · {a.budget.detail}</p>
            <ul>{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {a.risks.length > 0 && <><b>Risks</b><ul>{a.risks.map((r) => <li key={r} className="error">{r}</li>)}</ul></>}
            {a.evidence.length > 0 && <><b>Portfolio to mention</b><ul>{a.evidence.map((e) => <li key={e.url}><a className="link" href={safeHref(e.url)} target="_blank" rel="noopener noreferrer nofollow">{e.url}</a>{e.matched.length ? ` (${e.matched.join(', ')})` : ''}</li>)}</ul></>}
            <p className="muted small">Computed from the job post and your profile. It is advice, not a guarantee.</p>
          </section>

          <section className="card" aria-labelledby="proposal-heading">
            <h3 id="proposal-heading">Proposal</h3>
            {!proposal && data.status === 'new' && (
              <button className="btn primary" type="button" disabled={busy} onClick={() => void run(async () => {
                const r = await api<{ ai_note?: string; mode?: string }>('/api/v1/proposals/generate', 'POST', { opportunity_id: id, currency: data.opportunity.currency });
                return r?.mode === 'safe_template' ? `Template draft created${r.ai_note ? `: ${r.ai_note}` : ''}. Rewrite it in your words before approving.` : `AI draft created${r?.ai_note ? `. ${r.ai_note}` : ''}. Check every sentence before approving.`;
              })}>Draft proposal</button>
            )}
            {proposal && (
              <>
                <p className="muted">Version {proposal.version} · {proposal.status.replace('_', ' ')}</p>
                {['draft', 'pending_approval', 'rejected'].includes(proposal.status) ? (
                  <>
                    <div className="field"><label htmlFor="op-edit">Proposal text (approval is tied to this exact text)</label><textarea id="op-edit" rows={10} value={edit} onChange={(e) => setEdit(e.target.value)} /></div>
                    <div className="row">
                      <button className="btn" type="button" disabled={busy || edit === proposal.content || edit.trim().length < 30} onClick={() => void run(async () => { await api(`/api/v1/proposals/${proposal.id}`, 'PUT', { content: edit }); return 'Saved as a new version. Any pending approval was cancelled.'; })}>Save as new version</button>
                      {!pending && proposal.status !== 'approved' && <button className="btn" type="button" disabled={busy || edit !== proposal.content} onClick={() => void run(async () => { await api(`/api/v1/proposals/${proposal.id}/request-approval`, 'POST'); return 'Approval requested for this exact text.'; })}>Request approval</button>}
                      {pending && <button className="btn primary" type="button" disabled={busy} onClick={() => void run(async () => { await api(`/api/v1/approvals/${pending.id}/decision`, 'POST', { decision: 'approved' }); return 'Approved. Apply on the original site, then record the submission below.'; })}>Approve this exact text</button>}
                      {pending && <button className="btn" type="button" disabled={busy} onClick={() => void run(async () => { await api(`/api/v1/approvals/${pending.id}/decision`, 'POST', { decision: 'rejected' }); return 'Rejected. Edit and request approval again.'; })}>Reject</button>}
                    </div>
                  </>
                ) : (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{proposal.content}</p>
                )}
                {proposal.versions.length > 0 && (
                  <details><summary>Version history ({proposal.versions.length})</summary>
                    <ol reversed>{proposal.versions.map((v) => <li key={v.version}>Version {v.version} · {SOURCE_LABEL[v.source] ?? v.source} · {when(v.created_at)}</li>)}</ol>
                  </details>
                )}
              </>
            )}
          </section>

          <section className="card" aria-labelledby="status-heading">
            <h3 id="status-heading">Applications and status</h3>
            {data.applications.length > 0 && <ul aria-label="Submissions">{data.applications.map((ap) => <li key={ap.id}>{ap.channel.replace('_', ' ')} · {ap.status} · {when(ap.sent_at)}{ap.reference ? ` · ref ${ap.reference}` : ''}{ap.replies ? ` · ${ap.replies} repl${ap.replies === 1 ? 'y' : 'ies'}` : ''}</li>)}</ul>}
            {data.allowed_transitions.includes('applied') && (
              <div className="row">
                <div className="field"><label htmlFor="op-channel">Where you applied</label>
                  <select id="op-channel" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="external_site">On the original site</option><option value="email">By email</option><option value="other">Other</option></select></div>
                <div className="field"><label htmlFor="op-ref">Reference (optional)</label><input id="op-ref" value={reference} maxLength={255} onChange={(e) => setReference(e.target.value)} placeholder="Bid number or link" /></div>
              </div>
            )}
            {data.allowed_transitions.length > 0 && (
              <>
                <div className="field"><label htmlFor="op-status-note">Note for this change (optional)</label><input id="op-status-note" value={statusNote} maxLength={2000} onChange={(e) => setStatusNote(e.target.value)} /></div>
                <div className="row">
                  {data.allowed_transitions.map((t) => (
                    <button key={t} className={`btn${t === 'applied' || t === 'won' ? ' primary' : ''}`} type="button" disabled={busy} onClick={() => move(t)}>{transitionLabel(t)}</button>
                  ))}
                </div>
              </>
            )}
            {data.allowed_transitions.length === 0 && <p className="muted">This opportunity is closed.</p>}
          </section>

          <section className="card" aria-labelledby="follow-heading">
            <h3 id="follow-heading">Follow-ups, interviews and notes</h3>
            {!data.history_available && <p className="muted">History and follow-ups switch on after a database update (migration 0069).</p>}
            {data.history_available && (
              <form className="row" onSubmit={addEvent}>
                <div className="field"><label htmlFor="op-kind">Type</label>
                  <select id="op-kind" value={kind} onChange={(e) => setKind(e.target.value as 'follow_up' | 'interview' | 'note')}><option value="follow_up">Follow-up</option><option value="interview">Interview</option><option value="note">Note</option></select></div>
                {kind !== 'note' && <div className="field"><label htmlFor="op-due">Date</label><input id="op-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>}
                <div className="field"><label htmlFor="op-note">What</label><input id="op-note" value={eventNote} maxLength={2000} onChange={(e) => setEventNote(e.target.value)} /></div>
                <button className="btn" type="submit" disabled={busy || eventNote.trim().length < 2}>Add</button>
              </form>
            )}
            <ol aria-label="History">
              {data.events.map((ev) => (
                <li key={ev.id}>
                  <span className="muted">{when(ev.created_at)}</span>{' '}
                  {ev.kind === 'status' && <>Status {ev.from_status ? `${EXTERNAL_STATUS_LABELS[ev.from_status] ?? ev.from_status} → ` : ''}{EXTERNAL_STATUS_LABELS[ev.to_status ?? ''] ?? ev.to_status}</>}
                  {ev.kind === 'submission' && <>Submitted</>}
                  {(ev.kind === 'follow_up' || ev.kind === 'interview') && <>{ev.kind === 'interview' ? 'Interview' : 'Follow-up'} on {ev.due_date}{ev.done_at ? ' (done)' : ''}</>}
                  {ev.kind === 'note' && <>Note</>}
                  {ev.note ? <span> — {ev.note}</span> : null}
                  {(ev.kind === 'follow_up' || ev.kind === 'interview') && !ev.done_at && (
                    <> <button className="link" type="button" disabled={busy} onClick={() => void run(async () => { await api(`/api/v1/opportunity-events/${ev.id}/done`, 'POST'); return 'Marked as done.'; })}>Mark done</button></>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
