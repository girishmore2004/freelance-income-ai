'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { formatMinor, linesToList } from '@/lib/listing-format';
import { FileLink, FilesPanel, type FilesState } from './files-panel';

/**
 * Shared delivery workspace for one contract: milestones with deliveries and
 * reviews, files, messages between the parties, and the activity log.
 */

type Submission = { id: string; status: string; note: string; links: string[]; submitted_at: string; reviewed_at: string | null; review_note: string; files?: { id: string; filename: string; size_bytes: number }[] };
type MilestoneView = { index: number; title: string; amount_minor: number; due_date: string | null; state: string; revisions_used: number; submissions: Submission[] };
type Workspace = {
  contract_id: string; status: string; party: 'client' | 'freelancer'; can_manage: boolean; revision_rounds: number; currency: string;
  milestones: MilestoneView[]; approved_minor: number; total_minor: number;
  messages: { id: string; from: string; mine: boolean; body: string; created_at: string }[];
  activity: { actor: string; type: string; details: Record<string, unknown>; created_at: string }[];
  funding_note: string;
};

type Checklist = { items: { criterion: string; mentioned: boolean }[]; summary: string; note: string };

const STATE_LABELS: Record<string, string> = { pending: 'Not delivered', submitted: 'Waiting for review', approved: 'Approved', revision_requested: 'Revision requested' };
const EVENT_LABELS: Record<string, string> = {
  'offer.sent': 'Offer sent', 'offer.declined': 'Offer declined', 'offer.withdrawn': 'Offer withdrawn', 'terms.proposed': 'New terms proposed',
  'terms.accepted': 'Terms accepted', 'contract.activated': 'Contract active', 'milestone.submitted': 'Work delivered',
  'milestone.approved': 'Milestone approved', 'milestone.revision_requested': 'Revision requested', 'contract.completed': 'Contract completed',
};

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

/** Which part of the workspace a contract tab shows. */
export type WorkspaceView = 'delivery' | 'files' | 'messages' | 'activity';

export function ContractWorkspace({ contractId, onChanged, view = 'delivery' }: { contractId: string; onChanged: () => void; view?: WorkspaceView }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [message, setMessage] = useState('');
  const [deliverFor, setDeliverFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [links, setLinks] = useState('');
  const [reviewFor, setReviewFor] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [files, setFiles] = useState<FilesState | null>(null);
  const [attach, setAttach] = useState<string[]>([]);
  const [filesTried, setFilesTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<Workspace>(`/api/v1/contracts/${contractId}/workspace`);
      // Never render a malformed reply (it would take the whole contracts page down).
      if (data && Array.isArray(data.milestones) && Array.isArray(data.messages) && Array.isArray(data.activity)) setWs(data);
      else setError('Could not load the workspace. Please refresh.');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [contractId]);

  const loadFiles = useCallback(async () => {
    try {
      const data = await api<FilesState>(`/api/v1/contracts/${contractId}/files`);
      setFiles(data && Array.isArray(data.files) && Array.isArray(data.allowed) ? data : null);
    } catch {
      setFiles(null); // Files are optional; the workspace works without them.
    } finally {
      setFilesTried(true);
    }
  }, [contractId]);

  useEffect(() => { void load(); void loadFiles(); }, [load, loadFiles]);

  async function run(work: () => Promise<{ message?: string }>, after?: () => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      setNotice(result.message ?? 'Done');
      after?.();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    void run(() => api(`/api/v1/contracts/${contractId}/messages`, 'POST', { body: message }), () => setMessage(''));
  }

  function deliver(event: FormEvent, index: number) {
    event.preventDefault();
    void run(
      () => api(`/api/v1/contracts/${contractId}/milestones/${index}/submit`, 'POST', { note, links: linesToList(links), ...(attach.length ? { file_ids: attach } : {}) }),
      () => { setDeliverFor(null); setNote(''); setLinks(''); setAttach([]); void loadFiles(); },
    );
  }

  async function startReview(index: number) {
    setReviewFor(index);
    setChecklist(null);
    try {
      const result = await api<Checklist>(`/api/v1/contracts/${contractId}/milestones/${index}/acceptance-check`);
      if (result && Array.isArray(result.items)) setChecklist(result);
    } catch {
      // The checklist is optional help; reviewing works without it.
    }
  }

  function review(index: number, decision: 'approve' | 'request_revision') {
    void run(
      () => api(`/api/v1/contracts/${contractId}/milestones/${index}/review`, 'POST', { decision, note: reviewNote }),
      () => { setReviewFor(null); setReviewNote(''); },
    );
  }

  if (!ws) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading workspace…</p>;
  const open = ws.status === 'active';

  return (
    <section className="card" aria-label="Delivery workspace">
      <p className="muted">Approved {formatMinor(ws.approved_minor, ws.currency)} of {formatMinor(ws.total_minor, ws.currency)} · {ws.revision_rounds} revision round{ws.revision_rounds === 1 ? '' : 's'} per milestone</p>
      {view === 'delivery' && <p className="muted">{ws.funding_note}</p>}
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {view === 'delivery' && ws.milestones.map((m) => (
        <div className="card item" key={m.index}>
          <div className="row between">
            <b>{m.index + 1}. {m.title}</b>
            <span className="badge">{STATE_LABELS[m.state] ?? m.state}</span>
          </div>
          <p className="muted">{formatMinor(m.amount_minor, ws.currency)}{m.due_date ? ` · due ${m.due_date}` : ''}{m.revisions_used ? ` · revisions used ${m.revisions_used}/${ws.revision_rounds}` : ''}</p>
          {m.submissions.slice(0, 3).map((s) => (
            <div key={s.id}>
              <p style={{ whiteSpace: 'pre-wrap' }}>{s.note}</p>
              {s.links.length > 0 && <ul>{s.links.map((l) => <li key={l}><a className="link" href={l} target="_blank" rel="noopener noreferrer nofollow">{l}</a></li>)}</ul>}
              {s.files && s.files.length > 0 && <ul aria-label="Delivered files">{s.files.map((f) => <li key={f.id}><FileLink file={f} onError={setError} /></li>)}</ul>}
              {s.review_note && <p className="muted">Client: {s.review_note}</p>}
            </div>
          ))}

          {open && ws.party === 'freelancer' && ['pending', 'revision_requested'].includes(m.state) && (
            deliverFor === m.index ? (
              <form onSubmit={(e) => deliver(e, m.index)}>
                <div className="field"><label htmlFor={`note-${m.index}`}>What are you delivering?</label><textarea id={`note-${m.index}`} rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <div className="field"><label htmlFor={`links-${m.index}`}>Links (https, one per line)</label><textarea id={`links-${m.index}`} rows={2} value={links} onChange={(e) => setLinks(e.target.value)} /></div>
                {files && files.files.some((f) => f.mine && !f.attached) && (
                  <fieldset>
                    <legend>Attach uploaded files</legend>
                    {files.files.filter((f) => f.mine && !f.attached).map((f) => (
                      <label key={f.id} className="row">
                        <input type="checkbox" checked={attach.includes(f.id)} onChange={(e) => setAttach((a) => (e.target.checked ? [...a, f.id] : a.filter((x) => x !== f.id)))} /> {f.filename}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="row">
                  <button className="btn primary" type="submit" disabled={busy}>Deliver</button>
                  <button className="btn" type="button" onClick={() => setDeliverFor(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => setDeliverFor(m.index)}>Deliver work</button>
            )
          )}

          {open && ws.party === 'client' && ws.can_manage && m.state === 'submitted' && (
            reviewFor === m.index ? (
              <div>
                {checklist && (
                  <div aria-label="Acceptance checklist">
                    <b>Acceptance checklist</b>
                    <ul>{checklist.items.map((i) => <li key={i.criterion}>{i.mentioned ? '✓' : '✗'} {i.criterion}</li>)}</ul>
                    <p className="muted">{checklist.summary} {checklist.note}</p>
                  </div>
                )}
                <div className="field"><label htmlFor={`review-${m.index}`}>Feedback (required to request a revision)</label><textarea id={`review-${m.index}`} rows={2} maxLength={5000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /></div>
                <div className="row">
                  <button className="btn primary" disabled={busy} onClick={() => review(m.index, 'approve')}>Approve milestone</button>
                  <button className="btn" disabled={busy || m.revisions_used >= ws.revision_rounds} onClick={() => review(m.index, 'request_revision')}>Request revision</button>
                  <button className="btn" type="button" onClick={() => setReviewFor(null)}>Cancel</button>
                </div>
                {m.revisions_used >= ws.revision_rounds && <p className="muted">All agreed revision rounds are used.</p>}
              </div>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => void startReview(m.index)}>Review delivery</button>
            )
          )}
        </div>
      ))}

      {view === 'files' && !files && <p className="muted">{filesTried ? 'File sharing is not available for this contract right now. Share links in a delivery note instead.' : 'Loading files…'}</p>}
      {view === 'files' && files && <FilesPanel contractId={contractId} state={files} canUpload={open && ws.can_manage} onChanged={loadFiles} onError={setError} />}

      {view === 'messages' && <>
      {ws.messages.length === 0 && <p className="empty">No messages yet.</p>}
      <ul aria-label="Messages">
        {ws.messages.map((msg) => (
          <li key={msg.id}><b>{msg.mine ? 'You' : msg.from === 'client' ? 'Client' : 'Freelancer'}:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</span> <span className="muted">{new Date(msg.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></li>
        ))}
      </ul>
      {['offered', 'active'].includes(ws.status) && (
        <form className="row" onSubmit={send}>
          <div className="field"><label htmlFor={`msg-${contractId}`}>Message</label><textarea id={`msg-${contractId}`} rows={2} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <button className="btn" type="submit" disabled={busy || !message.trim()}>Send</button>
        </form>
      )}
      </>}

      {view === 'activity' && ws.activity.length === 0 && <p className="empty">No activity yet.</p>}
      {view === 'activity' && ws.activity.length > 0 && (
        <>
          <ul aria-label="Activity">{ws.activity.slice(0, 50).map((a, i) => <li key={i} className="muted">{EVENT_LABELS[a.type] ?? a.type}{typeof a.details.title === 'string' ? `: ${a.details.title}` : ''} · {new Date(a.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</li>)}</ul>
        </>
      )}
    </section>
  );
}
