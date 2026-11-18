'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { INTERVIEW_LABELS, isDiscussion, localInputToIso, type Discussion, type Interview } from '@/lib/discussion';
import { safeHref } from '@/lib/safe-url';

/**
 * Messages and interview times on one proposal, before any offer (U9).
 * Both sides see the same thread. Contact and payment details are refused by
 * the server; after an offer the conversation continues on the contract.
 */

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function DiscussionPanel({ proposalId }: { proposalId: string }) {
  const [data, setData] = useState<Discussion | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [slot, setSlot] = useState({ starts_at: '', duration_minutes: '30', mode: 'video', meeting_link: '', agenda: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<Discussion>(`/api/v1/listing-proposals/${proposalId}/discussion`);
      if (isDiscussion(result)) setData(result);
      else setError('This discussion could not be loaded.');
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'MIGRATION_PENDING' ? 'Messages and interviews are not switched on yet.' : messageOf(e));
    }
  }, [proposalId]);

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
      if (e instanceof ApiError && e.code === 'INVALID_INTERVIEW' && Array.isArray(e.details) && e.details[0] && typeof e.details[0] === 'object') {
        setFieldErrors(e.details[0] as Record<string, string>);
      }
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(() => api(`/api/v1/listing-proposals/${proposalId}/messages`, 'POST', { body: text.trim() }), 'Message sent')) setText('');
  }

  async function propose(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    const startsAt = localInputToIso(slot.starts_at);
    if (!startsAt) { setFieldErrors({ starts_at: 'Choose a date and time.' }); return; }
    const ok = await run(
      () => api(`/api/v1/listing-proposals/${proposalId}/interviews`, 'POST', { ...slot, starts_at: startsAt, duration_minutes: Number(slot.duration_minutes) }),
      'Interview time proposed. The other side will be asked to accept it.'
    );
    if (ok) { setScheduling(false); setSlot({ starts_at: '', duration_minutes: '30', mode: 'video', meeting_link: '', agenda: '' }); }
  }

  function act(i: Interview, path: 'respond' | 'cancel' | 'complete', payload: Record<string, string>, done: string) {
    void run(() => api(`/api/v1/proposal-interviews/${i.id}/${path}`, 'POST', payload), done).then((ok) => { if (ok) setCompleteFor(null); });
  }

  if (!data) {
    return <div className="card" aria-live="polite">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading messages…</p>}</div>;
  }
  const other = data.party === 'client' ? 'freelancer' : 'client';
  const now = Date.now();

  return (
    <section className="card" aria-label="Messages and interviews">
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {data.note && <p className="muted">{data.note} <a className="link" href="/contracts">Open contracts</a></p>}

      <b>Interviews</b>
      {data.interviews.length === 0 && <p className="muted">No interview times yet.</p>}
      <ul aria-label="Interviews">
        {data.interviews.map((i) => {
          const started = new Date(i.starts_at).getTime() <= now;
          return (
            <li key={i.id} className="item">
              <span><b>{when(i.starts_at)}</b> · {i.duration_minutes} min {i.mode} · <span className="badge">{INTERVIEW_LABELS[i.status] ?? i.status}</span></span>
              {i.status === 'proposed' && <span className="muted"> {i.mine ? `Waiting for the ${other}` : `Proposed by the ${other}`}</span>}
              {i.meeting_link && i.status === 'accepted' && <> · <a className="link" href={safeHref(i.meeting_link)} target="_blank" rel="noopener noreferrer nofollow">Join link</a></>}
              {i.agenda && <p className="muted">{i.agenda}</p>}
              {i.outcome_note && <p className="muted">Notes: {i.outcome_note}</p>}
              <div className="row">
                {i.status === 'proposed' && !i.mine && !started && data.can_schedule && (
                  <>
                    <button className="btn primary" disabled={busy} onClick={() => act(i, 'respond', { response: 'accept' }, 'Interview accepted')}>Accept time</button>
                    <button className="btn" disabled={busy} onClick={() => act(i, 'respond', { response: 'decline' }, 'Interview declined')}>Decline time</button>
                  </>
                )}
                {['proposed', 'accepted'].includes(i.status) && !started && data.can_schedule && (
                  <button className="btn" disabled={busy} onClick={() => act(i, 'cancel', {}, 'Interview cancelled')}>Cancel interview</button>
                )}
                {i.status === 'accepted' && started && data.party === 'client' && data.can_schedule && completeFor !== i.id && (
                  <button className="btn" disabled={busy} onClick={() => { setCompleteFor(i.id); setNote(''); }}>Mark as held</button>
                )}
              </div>
              {completeFor === i.id && (
                <div className="field">
                  <label htmlFor={`note-${i.id}`}>Private notes (optional)</label>
                  <textarea id={`note-${i.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="row">
                    <button className="btn primary" disabled={busy} onClick={() => act(i, 'complete', { note }, 'Interview recorded')}>Save</button>
                    <button className="btn" onClick={() => setCompleteFor(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data.can_schedule && !scheduling && <button className="btn" type="button" onClick={() => setScheduling(true)}>Propose an interview time</button>}
      {scheduling && (
        <form onSubmit={propose} className="card" aria-label="Propose an interview">
          <div className="field">
            <label htmlFor="iv-start">Date and time (your time zone)</label>
            <input id="iv-start" type="datetime-local" value={slot.starts_at} onChange={(e) => setSlot({ ...slot, starts_at: e.target.value })} required />
            {fieldErrors.starts_at && <span className="error">{fieldErrors.starts_at}</span>}
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="iv-duration">Length</label>
              <select id="iv-duration" value={slot.duration_minutes} onChange={(e) => setSlot({ ...slot, duration_minutes: e.target.value })}>
                {['15', '30', '45', '60', '90'].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="iv-mode">How</label>
              <select id="iv-mode" value={slot.mode} onChange={(e) => setSlot({ ...slot, mode: e.target.value })}>
                <option value="video">Video call</option>
                <option value="phone">Phone call (through your own app; numbers are not shared here)</option>
                <option value="chat">Chat here</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="iv-link">Meeting link (optional: Google Meet, Zoom, Teams, Whereby or Jitsi)</label>
            <input id="iv-link" type="url" value={slot.meeting_link} onChange={(e) => setSlot({ ...slot, meeting_link: e.target.value })} />
            {fieldErrors.meeting_link && <span className="error">{fieldErrors.meeting_link}</span>}
          </div>
          <div className="field">
            <label htmlFor="iv-agenda">Agenda (optional)</label>
            <textarea id="iv-agenda" rows={2} maxLength={1000} value={slot.agenda} onChange={(e) => setSlot({ ...slot, agenda: e.target.value })} />
            {fieldErrors.agenda && <span className="error">{fieldErrors.agenda}</span>}
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>Propose time</button>
            <button className="btn" type="button" onClick={() => setScheduling(false)}>Cancel</button>
          </div>
        </form>
      )}

      <b>Messages</b>
      {data.messages.length === 0 && <p className="muted">No messages yet. Ask a question about the scope, timeline or approach.</p>}
      <ol aria-label="Messages" className="thread">
        {data.messages.map((m) => (
          <li key={m.id} className={m.mine ? 'mine' : ''}>
            <span className="muted">{m.mine ? 'You' : m.from === 'client' ? 'Client' : 'Freelancer'} · {when(m.created_at)}</span>
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
          </li>
        ))}
      </ol>
      {data.can_message && (
        <form onSubmit={send}>
          <div className="field">
            <label htmlFor={`msg-${proposalId}`}>Message</label>
            <textarea id={`msg-${proposalId}`} rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="muted">Keep phone numbers, emails and payments on the platform.</span>
          </div>
          <button className="btn primary" type="submit" disabled={busy || !text.trim()}>Send message</button>
        </form>
      )}
    </section>
  );
}
