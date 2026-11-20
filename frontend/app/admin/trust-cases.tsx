'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';
import { RESOLUTION_LABELS } from '../contracts/dispute-panel';

/**
 * Staff: disputes (evidence pack + decision) and account suspensions with
 * appeals. The evidence pack is assembled from the platform record; no AI
 * proposes an outcome. Outcomes that move money are admin-only, and an appeal
 * is decided by a different staff member than the one who suspended.
 */

type DisputeRow = {
  id: string; contract_id: string; opened_by: string; reason: string; description: string; desired_outcome: string; status: string;
  resolution: string | null; created_at: string; contract_title: string; freelancer_name: string; organization_name: string; funded_unreleased_minor: number;
};
type Pack = {
  dispute: { statements: Array<{ id: string; party: string; body: string; created_at: string }>; respond_by?: string; replied?: boolean; ready_for_decision?: boolean };
  can_move_money: boolean;
  evidence: {
    contract: { status: string } | null;
    agreed_terms: { title: string; scope: string; currency: string; milestones: Array<{ title: string; amount_minor: number; due_date: string | null }>; acceptance_criteria: string[] } | null;
    submissions: Array<{ milestone_index: number; status: string; note: string; submitted_at: string | null; review_note: string | null }>;
    messages: Array<{ party: string; body: string; created_at: string | null }>;
    events: Array<{ party: string; type: string; created_at: string | null }>;
    payments: Array<{ id: string; milestone_index: number; amount_minor: number; currency: string; status: string; mode: string }>;
    previous_disputes: Array<{ id: string; status: string; resolution: string | null }>;
    summary: { milestones: number; milestones_approved: number; funded_unreleased_minor: number; funded_unreleased_count: number; submissions: number; messages: number };
  };
};
type Suspension = { id: string; user_id: string; email: string; name: string; reason: string; status: string; created_at: string; appeal_text: string; appeal_status: string; appeal_at: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');

export function TrustCases({ isAdmin }: { isAdmin: boolean }) {
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [packs, setPacks] = useState<Record<string, Pack>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [suspendId, setSuspendId] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api<DisputeRow[]>('/api/v1/admin/disputes?status=open'), api<Suspension[]>('/api/v1/admin/suspensions?status=active')]);
      setDisputes(Array.isArray(d) ? d : []);
      setSuspensions(Array.isArray(s) ? s : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load disputes and suspensions.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const note = (id: string) => notes[id] ?? '';
  const setNote = (id: string, value: string) => setNotes((n) => ({ ...n, [id]: value }));

  async function run(work: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = (await work()) as { message?: string } | null;
      setNotice(result && typeof result === 'object' && typeof result.message === 'string' ? result.message : fallback);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function openPack(id: string) {
    try {
      const pack = await api<Pack>(`/api/v1/admin/disputes/${id}`);
      if (pack && pack.evidence) setPacks((p) => ({ ...p, [id]: pack }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the evidence pack.');
    }
  }

  const resolve = (id: string, resolution: string) =>
    run(() => api(`/api/v1/admin/disputes/${id}/resolve`, 'POST', { resolution, note: note(id) }), 'Decision recorded');

  return (
    <div aria-busy={busy || undefined} style={{ display: "contents" }}>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      <section className="card" aria-labelledby="disputes-heading">
        <h3 id="disputes-heading">Open disputes</h3>
        {disputes.length === 0 && <p className="empty">No open disputes.</p>}
        {disputes.map((d) => {
          const pack = packs[d.id];
          return (
            <div className="item" key={d.id}>
              <div className="row between"><b>{d.contract_title || 'Contract'}</b><span className="muted">{when(d.created_at)}</span></div>
              <p className="muted">{d.organization_name} ↔ {d.freelancer_name} · opened by the {d.opened_by} · {d.reason} · funded, not released: {formatMinor(d.funded_unreleased_minor, 'INR')}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>
              {d.desired_outcome && <p className="muted">Asks for: {d.desired_outcome}</p>}
              {!pack && <button className="btn" type="button" onClick={() => void openPack(d.id)}>Open evidence pack</button>}
              {pack && (
                <div>
                  <p className="muted">
                    {pack.evidence.summary.milestones} milestones, {pack.evidence.summary.milestones_approved} approved · {pack.evidence.summary.submissions} deliveries ·{' '}
                    {pack.evidence.summary.messages} messages · {pack.evidence.summary.funded_unreleased_count} funded, not released
                  </p>
                  {pack.evidence.agreed_terms && (
                    <details>
                      <summary>Agreed terms</summary>
                      <p><b>{pack.evidence.agreed_terms.title}</b></p>
                      {pack.evidence.agreed_terms.scope && <p style={{ whiteSpace: 'pre-wrap' }}>{pack.evidence.agreed_terms.scope}</p>}
                      <ul>{pack.evidence.agreed_terms.milestones.map((m, i) => <li key={i}>{m.title}: {formatMinor(m.amount_minor, pack.evidence.agreed_terms!.currency)}{m.due_date ? ` · due ${m.due_date}` : ''}</li>)}</ul>
                      {pack.evidence.agreed_terms.acceptance_criteria.length > 0 && <p className="muted">Acceptance: {pack.evidence.agreed_terms.acceptance_criteria.join('; ')}</p>}
                    </details>
                  )}
                  <details>
                    <summary>Deliveries ({pack.evidence.submissions.length})</summary>
                    <ul>{pack.evidence.submissions.map((s, i) => <li key={i}>Milestone {s.milestone_index + 1} · {s.status} · {when(s.submitted_at)}: {s.note}{s.review_note ? ` (client: ${s.review_note})` : ''}</li>)}</ul>
                  </details>
                  <details>
                    <summary>Messages ({pack.evidence.messages.length})</summary>
                    <ul>{pack.evidence.messages.map((m, i) => <li key={i}><b>{m.party}:</b> {m.body} <span className="muted">{when(m.created_at)}</span></li>)}</ul>
                  </details>
                  <details>
                    <summary>Payments ({pack.evidence.payments.length})</summary>
                    <ul>{pack.evidence.payments.map((p) => <li key={p.id}>Milestone {p.milestone_index + 1}: {formatMinor(p.amount_minor, p.currency)} · {p.status}{p.mode === 'sandbox' ? ' (test)' : ''}</li>)}</ul>
                  </details>
                  <details>
                    <summary>Activity ({pack.evidence.events.length})</summary>
                    <ul>{pack.evidence.events.map((e, i) => <li key={i}>{when(e.created_at)} · {e.party} · {e.type}</li>)}</ul>
                  </details>
                  <details open>
                    <summary>Statements ({pack.dispute.statements.length})</summary>
                    <ul>{pack.dispute.statements.map((s) => <li key={s.id}><b>{s.party}:</b> {s.body}</li>)}</ul>
                  </details>
                  {pack.evidence.previous_disputes.length > 0 && <p className="muted">Earlier disputes on this contract: {pack.evidence.previous_disputes.length}</p>}
                  <div className="field">
                    <label htmlFor={`dnote-${d.id}`}>Decision explanation (both parties see it; at least 20 characters)</label>
                    <textarea id={`dnote-${d.id}`} rows={3} value={note(d.id)} onChange={(e) => setNote(d.id, e.target.value)} />
                  </div>
                  {pack.dispute.ready_for_decision === false && pack.dispute.respond_by && (
                    <p className="notice" role="status">Waiting for the other side's answer until {new Date(pack.dispute.respond_by).toLocaleDateString()}. You can decide once they answer or the 7 days pass; suspend an account separately if there is fraud.</p>
                  )}
                  <div className="row">
                    <button className="btn" disabled={busy || pack.dispute.ready_for_decision === false} onClick={() => void resolve(d.id, 'no_action')}>No money moves</button>
                    {pack.can_move_money && pack.evidence.summary.funded_unreleased_count > 0 && (
                      <>
                        <button className="btn primary" disabled={busy || pack.dispute.ready_for_decision === false} onClick={() => void resolve(d.id, 'release_funded')}>Release funded to freelancer</button>
                        <button className="btn" disabled={busy || pack.dispute.ready_for_decision === false} onClick={() => void resolve(d.id, 'refund_funded')}>Refund funded to client</button>
                      </>
                    )}
                  </div>
                  {!pack.can_move_money && <p className="muted">Only an admin can release or refund funds.</p>}
                  <p className="muted">{Object.entries(RESOLUTION_LABELS).map(([k, v]) => `${k === 'no_action' ? 'No money moves' : k === 'release_funded' ? 'Release' : 'Refund'}: ${v}`).join(' · ')}</p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="card" aria-labelledby="suspensions-heading">
        <h3 id="suspensions-heading">Account suspensions</h3>
        <p className="muted">A suspended person can still sign in, read their contracts and payments, and appeal. They cannot send proposals, hire, message, fund or withdraw, and they are hidden from discovery.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api(`/api/v1/admin/users/${encodeURIComponent(suspendId.trim())}/suspend`, 'POST', { reason: suspendReason }), 'Account suspended').then(() => { setSuspendId(''); setSuspendReason(''); }); }}>
          <div className="field"><label htmlFor="suspend-id">User ID (from a report)</label><input id="suspend-id" value={suspendId} onChange={(e) => setSuspendId(e.target.value)} /></div>
          <div className="field"><label htmlFor="suspend-reason">Reason the person will see (at least 20 characters)</label><input id="suspend-reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} /></div>
          <button className="btn" type="submit" disabled={busy || !suspendId.trim() || suspendReason.trim().length < 20}>Suspend</button>
        </form>
        {suspensions.length === 0 && <p className="empty">No active suspensions.</p>}
        {suspensions.map((s) => (
          <div className="item" key={s.id}>
            <div className="row between"><b>{s.name || s.email}</b><span className="badge">{s.appeal_status === 'pending' ? 'Appeal pending' : s.appeal_status === 'upheld' ? 'Appeal rejected' : 'Suspended'}</span></div>
            <p className="muted">{s.email} · since {when(s.created_at)}</p>
            <p>{s.reason}</p>
            {s.appeal_text && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>Appeal ({when(s.appeal_at)}): {s.appeal_text}</p>}
            <div className="field"><label htmlFor={`snote-${s.id}`}>Decision note</label><input id={`snote-${s.id}`} value={note(s.id)} onChange={(e) => setNote(s.id, e.target.value)} /></div>
            <div className="row">
              {s.appeal_status === 'pending' && (
                <>
                  <button className="btn primary" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/suspensions/${s.id}/appeal`, 'POST', { decision: 'overturn', note: note(s.id) }), 'Suspension lifted')}>Accept appeal</button>
                  <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/suspensions/${s.id}/appeal`, 'POST', { decision: 'uphold', note: note(s.id) }), 'Appeal rejected')}>Reject appeal</button>
                </>
              )}
              <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/suspensions/${s.id}/lift`, 'POST', { note: note(s.id) }), 'Suspension lifted')}>Lift suspension</button>
            </div>
          </div>
        ))}
        {!isAdmin && <p className="muted">Moderators can suspend and lift; money decisions in disputes need an admin.</p>}
      </section>
    </div>
  );
}
