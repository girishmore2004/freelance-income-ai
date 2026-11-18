'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatBudget } from '@/lib/listing-format';
import { TrustCases } from './trust-cases';

/**
 * Staff admin (moderator/admin). Moderation queue for held listings, user
 * reports, disputes, suspensions and appeals, platform overview and feature
 * flags (admin only; real payments cannot be switched on here). Every decision
 * is logged.
 */

type Held = { id: string; organization_name: string; findings: string[]; waiting_since: string; brief: { title: string; outcome: string; description: string; budget_min_minor: number | null; budget_max_minor: number | null; currency: string; budget_model: string } };
type Report = { id: string; target_type: string; target_id: string; reason: string; details: string; status: string; created_at: string };
type Flag = { key: string; enabled: boolean; description: string; locked: boolean };
type Overview = { counts: Record<string, number | null>; flags: Flag[]; is_admin: boolean };

const FINDINGS: Record<string, string> = {
  off_platform_contact: 'Off-platform contact', off_platform_payment: 'Off-platform payment', upfront_fee: 'Upfront fee', prohibited_work: 'Prohibited work', link_shortener: 'Link shortener',
};
const COUNT_LABELS: Array<[string, string]> = [
  ['users', 'Users'], ['clients', 'Clients'], ['listings_published', 'Published projects'], ['listings_in_review', 'Waiting for review'], ['proposals', 'Proposals'],
  ['contracts_active', 'Active contracts'], ['contracts_completed', 'Completed contracts'], ['reports_open', 'Open reports'], ['ai_calls_today', 'AI calls today'],
];

function age(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

export default function AdminPage() {
  const [token] = useSessionToken();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [held, setHeld] = useState<Held[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, h, r] = await Promise.all([
        api<Overview>('/api/v1/admin/overview'),
        api<Held[]>('/api/v1/admin/moderation/listings'),
        api<Report[]>('/api/v1/admin/reports?status=open'),
      ]);
      setOverview(o && o.counts ? o : null);
      setHeld(Array.isArray(h) ? h : []);
      setReports(Array.isArray(r) ? r : []);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setForbidden(true);
      else setError(e instanceof Error ? e.message : 'Could not load admin data.');
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function run(work: () => Promise<{ message?: string }>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      setNotice(result.message ?? 'Done');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const note = (id: string) => notes[id] ?? '';
  const setNote = (id: string, value: string) => setNotes((n) => ({ ...n, [id]: value }));

  if (!token) return <main className="shell"><div className="card"><h2>Admin</h2><p className="muted">Sign in first.</p><a className="btn" href="/">Go to sign in</a></div></main>;
  if (forbidden) return <main className="shell"><div className="card"><h2>Admin</h2><p className="muted">This page is for staff.</p><a className="btn" href="/">Back to workspace</a></div></main>;

  return (
    <main className="shell">
      <div className="row between"><h2>Admin</h2><span className="row"><a className="link" href="/finance">Finance</a><a className="link" href="/ai-agents">AI agents</a></span></div>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>

      {overview && (
        <section className="card" aria-labelledby="overview-heading">
          <h3 id="overview-heading">Overview</h3>
          <div className="grid">
            {COUNT_LABELS.map(([key, label]) => <div key={key} className="item"><b>{overview.counts[key] ?? 0}</b><div className="muted">{label}</div></div>)}
          </div>
          <p className="muted">Oldest listing waiting for review: {age(overview.counts.oldest_review_seconds)} · oldest open report: {age(overview.counts.oldest_report_seconds)} · estimated AI cost today ${((overview.counts.ai_cost_today_micros ?? 0) / 1_000_000).toFixed(2)}, this month ${((overview.counts.ai_cost_month_micros ?? 0) / 1_000_000).toFixed(2)}</p>
        </section>
      )}

      <section className="card" aria-labelledby="queue-heading">
        <h3 id="queue-heading">Moderation queue</h3>
        {held.length === 0 && <p className="empty">No listings waiting for review.</p>}
        {held.map((h) => (
          <div className="item" key={h.id}>
            <div className="row between"><b>{h.brief.title}</b><span className="badge">{h.findings.map((f) => FINDINGS[f] ?? f).join(', ') || 'Held'}</span></div>
            <p className="muted">{h.organization_name} · {formatBudget(h.brief.budget_min_minor, h.brief.budget_max_minor, h.brief.currency, h.brief.budget_model)} · waiting {age((Date.now() - Date.parse(h.waiting_since)) / 1000)}</p>
            <p>{h.brief.outcome}</p>
            {h.brief.description && <p className="muted">{h.brief.description}</p>}
            <div className="field"><label htmlFor={`note-${h.id}`}>Note to the client (required to return)</label><input id={`note-${h.id}`} value={note(h.id)} onChange={(e) => setNote(h.id, e.target.value)} /></div>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/moderation/listings/${h.id}`, 'POST', { decision: 'approve', note: note(h.id) }))}>Approve and publish</button>
              <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/moderation/listings/${h.id}`, 'POST', { decision: 'return', note: note(h.id) }))}>Return to client</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="reports-heading">
        <h3 id="reports-heading">Open reports</h3>
        {reports.length === 0 && <p className="empty">No open reports.</p>}
        {reports.map((r) => (
          <div className="item" key={r.id}>
            <div className="row between"><b>{r.target_type} · {r.reason}</b><span className="muted">{new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></div>
            <p className="muted">Target: {r.target_id}</p>
            {r.details && <p>{r.details}</p>}
            <div className="field"><label htmlFor={`rnote-${r.id}`}>Decision note</label><input id={`rnote-${r.id}`} value={note(r.id)} onChange={(e) => setNote(r.id, e.target.value)} /></div>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/reports/${r.id}`, 'POST', { decision: 'action', note: note(r.id), hide_listing: r.target_type === 'listing' }))}>{r.target_type === 'listing' ? 'Action and hide listing' : 'Action'}</button>
              <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/reports/${r.id}`, 'POST', { decision: 'dismiss', note: note(r.id) }))}>Dismiss</button>
            </div>
          </div>
        ))}
      </section>

      {overview && <TrustCases isAdmin={overview.is_admin} />}

      {overview && (
        <section className="card" aria-labelledby="flags-heading">
          <h3 id="flags-heading">Feature flags</h3>
          <ul>
            {overview.flags.map((f) => (
              <li key={f.key}>
                <b>{f.key}</b>: {f.enabled ? 'ON' : 'OFF'} <span className="muted">{f.description}</span>
                {f.locked
                  ? <span className="muted"> · locked (needs D-1/D-2)</span>
                  : overview.is_admin && <> <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/flags/${f.key}`, 'POST', { enabled: !f.enabled }))}>{f.enabled ? 'Turn off' : 'Turn on'}</button></>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
