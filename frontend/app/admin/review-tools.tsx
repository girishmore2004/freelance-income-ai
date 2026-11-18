'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { safeHref } from '@/lib/safe-url';

/**
 * Staff verification queues and external source management (U10, spec §14).
 * Reviews look at public evidence beside the account's own record; they are
 * never identity checks. Every decision needs a reason the person sees
 * (except approval) and is written to the moderation log.
 */

type Request = {
  id: string; subject_type: 'freelancer' | 'client'; subject_id: string; status: string; own_request: boolean; created_at: string;
  evidence: { links?: string[]; note?: string; registration_number?: string }; decision_note: string; facts: Record<string, unknown>;
};
type Source = {
  code: string; label: string; kind: string; access: string; enabled: boolean; switch_enabled: boolean; off_by_worker_setting: boolean; note: string;
  health: string; runs_7d: number; failures_7d: number; fetched_7d: number; stored_7d: number; last_success_at: string | null; last_error: string | null;
  freshness: { open: number; under_3_days: number; days_3_to_14: number; over_14_days: number; unknown: number };
};

const when = (v: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const HEALTH: Record<string, string> = { healthy: 'Healthy', failing: 'Failing', partly_failing: 'Some failures', no_runs: 'No runs in 7 days', off: 'Off' };
const FACT_LABELS: Record<string, string> = {
  name: 'Name', headline: 'Headline', skills: 'Skills', profile_links: 'Profile links', visible_to_clients: 'Visible to clients', email_verified: 'Email verified',
  account_created_at: 'Account created', completed_contracts: 'Completed contracts', reports: 'Reports', kind: 'Type', industry: 'Industry',
  website: 'Website on account', country: 'Country', status: 'Status', members: 'Members', projects: 'Projects posted',
};

function factValue(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return when(v);
  return String(v);
}

export function VerificationQueue() {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<Request[] | null>(null);
  const [meaning, setMeaning] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Request[]; meaning: string }>(`/api/v1/admin/verifications?status=${status}`);
      setItems(r && Array.isArray(r.items) ? r.items : []);
      setMeaning(r?.meaning ?? '');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function decide(r: Request, path: string, body: Record<string, string>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/admin/verifications/${r.id}${path}`, 'POST', body);
      setNotice(done);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="verify-heading">
      <h3 id="verify-heading">Freelancer and client verification</h3>
      {meaning && <p className="muted small">{meaning}</p>}
      <div className="row" role="group" aria-label="Request status">
        {['pending', 'approved', 'rejected', 'revoked'].map((s) => (
          <button key={s} className="btn" type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)} requests</button>
        ))}
      </div>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {items && items.length === 0 && <p className="empty">No {status} requests.</p>}
      <ul aria-label="Verification requests">
        {items?.map((r) => (
          <li key={r.id} className="card item">
            <div className="row between">
              <b>{r.subject_type === 'freelancer' ? 'Freelancer' : 'Client account'}: {String(r.facts.name ?? r.subject_id)}</b>
              <span className="muted small">{when(r.created_at)}</span>
            </div>
            <b className="small">Evidence given</b>
            <ul>
              {(r.evidence.links ?? []).map((l) => <li key={l}><a className="link" href={safeHref(l)} target="_blank" rel="noopener noreferrer nofollow">{l}</a></li>)}
              {r.evidence.registration_number && <li>Registration number: {r.evidence.registration_number}</li>}
              {r.evidence.note && <li>Note: {r.evidence.note}</li>}
            </ul>
            <b className="small">From the platform's records</b>
            <dl className="facts">
              {Object.entries(r.facts).map(([k, v]) => <div key={k}><dt>{FACT_LABELS[k] ?? k}</dt><dd>{factValue(v)}</dd></div>)}
            </dl>
            {r.decision_note && <p className="muted">Decision note: {r.decision_note}</p>}
            {r.own_request && <p className="muted">Your own request: another staff member decides it.</p>}
            {!r.own_request && ['pending', 'approved'].includes(r.status) && (
              <div className="field">
                <label htmlFor={`vnote-${r.id}`}>{r.status === 'pending' ? 'Reason (required to reject; the person sees it)' : 'Reason for revoking (the person sees it)'}</label>
                <textarea id={`vnote-${r.id}`} rows={2} maxLength={2000} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <div className="row">
                  {r.status === 'pending' && <>
                    <button className="btn primary" type="button" disabled={busy} onClick={() => void decide(r, '', { decision: 'approve', note: notes[r.id] ?? '' }, 'Approved')}>Approve</button>
                    <button className="btn" type="button" disabled={busy} onClick={() => void decide(r, '', { decision: 'reject', note: notes[r.id] ?? '' }, 'Rejected')}>Reject</button>
                  </>}
                  {r.status === 'approved' && <button className="btn" type="button" disabled={busy} onClick={() => void decide(r, '/revoke', { note: notes[r.id] ?? '' }, 'Badge removed')}>Revoke</button>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SourcesPanel() {
  const [items, setItems] = useState<Source[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [available, setAvailable] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Source[]; can_manage: boolean; available: boolean }>('/api/v1/admin/sources');
      setItems(r && Array.isArray(r.items) ? r.items : []);
      setCanManage(Boolean(r?.can_manage));
      setAvailable(r?.available !== false);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(s: Source) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/admin/sources/${s.code}`, 'POST', { enabled: !s.switch_enabled, note: notes[s.code] ?? '' });
      setNotice(`${s.label} switched ${s.switch_enabled ? 'off' : 'on'}`);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="sources-heading">
      <h3 id="sources-heading">External sources and freshness</h3>
      <p className="muted small">Last 7 days of discovery runs per source, and how old the open external opportunities are (by the original post date).</p>
      {!available && <p className="muted">Switches need database migration 0071; figures below still come from stored opportunities.</p>}
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {items && (
        <table>
          <caption className="sr-only">Sources</caption>
          <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Runs / failures</th><th scope="col">Fetched / stored</th><th scope="col">Open: &lt;3d · 3–14d · &gt;14d · no date</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{items.map((s) => (
            <tr key={s.code}>
              <td><b>{s.label}</b><div className="muted small">{s.kind === 'project' ? 'Projects' : 'Job board'} · {s.access}</div></td>
              <td>{HEALTH[s.health] ?? s.health}{s.off_by_worker_setting && <div className="muted small">Off: INCLUDE_JOB_BOARDS=false</div>}{s.note && <div className="muted small">{s.note}</div>}
                {s.last_error && <div className="muted small">Last error: {s.last_error.slice(0, 100)}</div>}<div className="muted small">Last success: {when(s.last_success_at)}</div></td>
              <td>{s.runs_7d} / {s.failures_7d}</td>
              <td>{s.fetched_7d} / {s.stored_7d}</td>
              <td>{s.freshness.under_3_days} · {s.freshness.days_3_to_14} · {s.freshness.over_14_days} · {s.freshness.unknown}</td>
              <td>{canManage && available && (
                <div className="field">
                  {s.switch_enabled && <><label className="sr-only" htmlFor={`snote-${s.code}`}>Reason for switching {s.label} off</label>
                    <input id={`snote-${s.code}`} placeholder="Reason to switch off" maxLength={500} value={notes[s.code] ?? ''} onChange={(e) => setNotes({ ...notes, [s.code]: e.target.value })} /></>}
                  <button className="btn" type="button" disabled={busy} onClick={() => void toggle(s)}>{s.switch_enabled ? `Switch ${s.label} off` : `Switch ${s.label} on`}</button>
                </div>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
