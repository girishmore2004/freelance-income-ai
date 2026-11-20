'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { buildTimeline, taskProgress, type TimelineActivity, type TimelineMilestone, type TimelineTask } from '@/lib/contract-timeline';
import { safeHref } from '@/lib/safe-url';

/**
 * Contract workspace tabs "Tasks", "Timeline" and "Handover" (U11).
 * Tasks: shared list, optionally generated once from the work category's
 * standard stages. Handover: the freelancer lists what they hand over; the
 * client confirms receipt. Passwords and keys are refused by the server.
 */

type Task = TimelineTask & { source: string };
type TaskState = { available: boolean; tasks: Task[]; can_edit: boolean; stages: string[]; milestones: Array<{ index: number; title: string; due_date: string | null }> };
type HandoverItem = { id: string; kind: string; title: string; link: string; note: string; status: string; created_at: string; confirmed_at: string | null };
type HandoverState = { available: boolean; items: HandoverItem[]; can_add: boolean; can_confirm: boolean };

const STATUS_LABELS: Record<string, string> = { todo: 'To do', doing: 'Doing', done: 'Done' };
const KIND_LABELS: Record<string, string> = { source_files: 'Source files', documentation: 'Documentation', access_transfer: 'Access transfer', deployment: 'Deployment', other: 'Other' };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
function fieldError(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details) && e.details[0] && typeof e.details[0] === 'object') {
    const first = Object.values(e.details[0] as Record<string, string>)[0];
    if (first) return first;
  }
  return messageOf(e);
}

function useTasks(contractId: string) {
  const [state, setState] = useState<TaskState | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await api<TaskState>(`/api/v1/contracts/${contractId}/tasks`);
      setState(r && Array.isArray(r.tasks) ? r : null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [contractId]);
  useEffect(() => { void load(); }, [load]);
  return { state, error, setError, load };
}

export function TasksPanel({ contractId }: { contractId: string }) {
  const { state, error, setError, load } = useTasks(contractId);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', owner_party: 'freelancer', milestone_index: '', due_date: '' });

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(fieldError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api(`/api/v1/contracts/${contractId}/tasks`, 'POST', {
      title: form.title, owner_party: form.owner_party, due_date: form.due_date || null,
      milestone_index: form.milestone_index === '' ? null : Number(form.milestone_index),
    }), 'Task added');
    if (ok) setForm({ ...form, title: '', due_date: '' });
  }

  if (!state) return <div aria-live="polite">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading tasks…</p>}</div>;
  if (!state.available) return <p className="muted">Tasks are not switched on yet.</p>;
  const progress = taskProgress(state.tasks);
  const milestoneTitle = (i: number | null) => (i === null ? '' : state.milestones[i]?.title ?? '');

  return (
    <section aria-busy={busy || undefined} aria-label="Tasks">
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {progress && <p className="muted">{progress.done} of {progress.total} tasks done</p>}
      {state.tasks.length === 0 && (
        <div className="card">
          <p className="empty">No tasks yet.</p>
          {state.can_edit && state.stages.length > 0 && (
            <>
              <p className="muted">Start from this category's standard stages: {state.stages.join(' → ')}. Review steps go to the client. You can edit everything afterwards.</p>
              <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/contracts/${contractId}/tasks/plan`, 'POST', {}), 'Task plan added')}>Add tasks from the standard stages</button>
            </>
          )}
        </div>
      )}
      <ul aria-label="Task list">
        {state.tasks.map((t) => (
          <li key={t.id} className="item row between">
            <span>
              <b>{t.title}</b>
              <span className="muted small"> · {t.owner_party === 'client' ? 'Client' : 'Freelancer'}{t.milestone_index !== null ? ` · ${milestoneTitle(t.milestone_index)}` : ''}{t.due_date ? ` · due ${t.due_date}` : ''}</span>
            </span>
            {state.can_edit ? (
              <span className="row" style={{ gap: 6 }}>
                <label className="sr-only" htmlFor={`st-${t.id}`}>Status of {t.title}</label>
                <select id={`st-${t.id}`} value={t.status} disabled={busy} onChange={(e) => void run(() => api(`/api/v1/contract-tasks/${t.id}`, 'POST', { status: e.target.value }), `${t.title}: ${STATUS_LABELS[e.target.value]}`)}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/contract-tasks/${t.id}/delete`, 'POST', {}), 'Task removed')}>Remove</button>
              </span>
            ) : <span className="badge">{STATUS_LABELS[t.status] ?? t.status}</span>}
          </li>
        ))}
      </ul>
      {state.can_edit && (
        <form onSubmit={add} className="card" aria-label="Add a task">
          <div className="field">
            <label htmlFor={`task-title-${contractId}`}>New task</label>
            <input id={`task-title-${contractId}`} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor={`task-owner-${contractId}`}>Who does it</label>
              <select id={`task-owner-${contractId}`} value={form.owner_party} onChange={(e) => setForm({ ...form, owner_party: e.target.value })}>
                <option value="freelancer">Freelancer</option><option value="client">Client</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`task-ms-${contractId}`}>Milestone</label>
              <select id={`task-ms-${contractId}`} value={form.milestone_index} onChange={(e) => setForm({ ...form, milestone_index: e.target.value })}>
                <option value="">None</option>
                {state.milestones.map((m) => <option key={m.index} value={String(m.index)}>{m.index + 1}. {m.title}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`task-due-${contractId}`}>Due date</label>
              <input id={`task-due-${contractId}`} type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy || form.title.trim().length < 2}>Add task</button>
        </form>
      )}
      {!state.can_edit && <p className="muted small">Only the freelancer and the client's owners and admins change tasks, while the contract is active.</p>}
    </section>
  );
}

type WorkspaceLite = { milestones: TimelineMilestone[]; activity: TimelineActivity[] };

/** This week's progress in plain sentences, from the contract record (U14). */
export function ProgressCard({ contractId }: { contractId: string }) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    api<{ lines: string[] }>(`/api/v1/contracts/${contractId}/progress`)
      .then((r) => setLines(r && Array.isArray(r.lines) ? r.lines : null))
      .catch(() => setLines(null));
  }, [contractId]);
  if (!lines) return null;
  return (
    <section className="card" aria-label="This week">
      <b>This week</b>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="muted small">Sent to both sides every Monday as a notification.</p>
    </section>
  );
}

export function TimelinePanel({ contractId }: { contractId: string }) {
  const { state, error } = useTasks(contractId);
  const [ws, setWs] = useState<WorkspaceLite | null>(null);
  const [wsError, setWsError] = useState('');
  useEffect(() => {
    api<WorkspaceLite>(`/api/v1/contracts/${contractId}/workspace`)
      .then((d) => { if (d && Array.isArray(d.milestones) && Array.isArray(d.activity)) setWs(d); else setWsError('The timeline could not be loaded.'); })
      .catch((e: unknown) => setWsError(messageOf(e)));
  }, [contractId]);
  if (!ws) return <div aria-live="polite">{wsError || error ? <p className="error" role="alert">{wsError || error}</p> : <p className="muted">Loading timeline…</p>}</div>;
  const today = new Date().toISOString().slice(0, 10);
  const entries = buildTimeline(ws.milestones, state?.tasks ?? [], ws.activity, today);
  const KIND: Record<string, string> = { past: 'Happened', due: 'Due', overdue: 'Overdue', done: 'Done' };
  return (
    <section aria-label="Timeline">
      <ProgressCard contractId={contractId} />
      {entries.length === 0 && <p className="empty">Nothing dated yet. Milestone and task due dates appear here.</p>}
      <ol aria-label="Timeline entries" className="timeline">
        {entries.map((e) => (
          <li key={e.key} className={e.kind}><span className="muted small">{e.date}</span> <span className="badge">{KIND[e.kind]}</span> {e.text}</li>
        ))}
      </ol>
    </section>
  );
}

export function HandoverPanel({ contractId }: { contractId: string }) {
  const [state, setState] = useState<HandoverState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: 'source_files', title: '', link: '', note: '' });

  const load = useCallback(async () => {
    try {
      const r = await api<HandoverState>(`/api/v1/contracts/${contractId}/handover`);
      setState(r && Array.isArray(r.items) ? r : null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [contractId]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(fieldError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api(`/api/v1/contracts/${contractId}/handover`, 'POST', form), 'Added to the handover')) setForm({ ...form, title: '', link: '', note: '' });
  }

  if (!state) return <div aria-live="polite">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading handover…</p>}</div>;
  if (!state.available) return <p className="muted">Handover is not switched on yet.</p>;
  const confirmed = state.items.filter((i) => i.status === 'confirmed').length;
  return (
    <section aria-busy={busy || undefined} aria-label="Handover">
      <p className="muted">List what you hand over at the end: source files, documentation, access and deployment notes. Transfer access through each service's own invite or team feature; never paste passwords or keys here.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {state.items.length > 0 && <p className="muted">{confirmed} of {state.items.length} items confirmed by the client</p>}
      {state.items.length === 0 && <p className="empty">Nothing handed over yet.</p>}
      <ul aria-label="Handover items">
        {state.items.map((i) => (
          <li key={i.id} className="card item">
            <div className="row between">
              <span><span className="badge">{KIND_LABELS[i.kind] ?? i.kind}</span> <b>{i.title}</b></span>
              <span className="badge">{i.status === 'confirmed' ? 'Receipt confirmed' : 'Waiting for the client'}</span>
            </div>
            {i.link && <a className="link" href={safeHref(i.link)} target="_blank" rel="noopener noreferrer nofollow">{i.link}</a>}
            {i.note && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{i.note}</p>}
            <div className="row">
              {state.can_confirm && i.status === 'pending' && <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/handover-items/${i.id}/confirm`, 'POST', {}), 'Receipt confirmed')}>Confirm receipt</button>}
              {state.can_add && i.status === 'pending' && <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/handover-items/${i.id}/withdraw`, 'POST', {}), 'Item withdrawn')}>Withdraw</button>}
            </div>
          </li>
        ))}
      </ul>
      {state.can_add && (
        <form onSubmit={add} className="card" aria-label="Add a handover item">
          <div className="row">
            <div className="field">
              <label htmlFor={`ho-kind-${contractId}`}>Type</label>
              <select id={`ho-kind-${contractId}`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`ho-title-${contractId}`}>Item</label>
              <input id={`ho-title-${contractId}`} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`ho-link-${contractId}`}>Link (optional, https)</label>
            <input id={`ho-link-${contractId}`} type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`ho-note-${contractId}`}>Note (optional)</label>
            <textarea id={`ho-note-${contractId}`} rows={2} maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <button className="btn" type="submit" disabled={busy || form.title.trim().length < 2}>Add to handover</button>
        </form>
      )}
    </section>
  );
}
