'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

/**
 * Staff operations (spec §14): user management with evidence and history,
 * the audit log of staff actions, and system health. Read-only views; actions
 * on a user (suspend, appeals) stay in Trust and safety, where they need a
 * reason and a second reviewer. Moderators see masked emails.
 */

type User = { id: string; email: string; created_at: string | null; email_verified: boolean | null; mfa_enabled: boolean; suspended: boolean; roles: string[] };
type UserDetail = {
  user: User; profile: { full_name: string; headline: string } | null;
  organizations: Array<{ id: string; name: string; role: string; status: string }>;
  counts: Record<string, number>;
  suspensions: Array<{ id: string; reason: string; status: string; created_at: string; lifted_at: string | null; appeal_status: string | null }>;
  staff_actions: Array<{ actor_user_id: string | null; target_type: string; target_id: string; action: string; note: string; created_at: string }>;
};
type AuditItem = { id: string; actor_user_id: string | null; actor_email: string | null; target_type: string; target_id: string; action: string; note: string; created_at: string };
type Health = {
  version: string; environment: string; database: { ok: boolean; latency_ms: number };
  migration: { current: string | null; expected: string; ok: boolean; readable: boolean };
  configuration: Array<{ key: string; ok: boolean; detail: string }>;
  ai_today: { calls: number; cost_usd: number }; queues: Record<string, number>;
};

const when = (v: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const COUNT_LABELS: Record<string, string> = {
  proposals: 'Proposals', contracts_as_freelancer: 'Contracts as freelancer', listings_created: 'Projects created',
  reports_against: 'Reports against', reports_made: 'Reports made', disputes_opened: 'Disputes opened',
};

export function UsersPanel() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [items, setItems] = useState<User[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState('');

  const search = useCallback(async (before?: string) => {
    setError('');
    try {
      const params = new URLSearchParams({ q, role, ...(before ? { before } : {}) });
      const r = await api<{ items: User[]; next_before: string | null }>(`/api/v1/admin/users?${params.toString()}`);
      const list = Array.isArray(r?.items) ? r.items : [];
      setItems((prev) => (before && prev ? [...prev, ...list] : list));
      setNext(typeof r?.next_before === 'string' ? r.next_before : null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [q, role]);

  useEffect(() => { void search(); }, [search]);

  async function open(id: string) {
    setError('');
    try {
      const d = await api<UserDetail>(`/api/v1/admin/users/${encodeURIComponent(id)}`);
      if (d && d.user && Array.isArray(d.suspensions)) setDetail(d);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void search();
  }

  return (
    <section className="card" aria-labelledby="users-heading">
      <h3 id="users-heading">Users</h3>
      <form className="row" role="search" onSubmit={submit}>
        <div className="field"><label htmlFor="user-q">Email or user ID</label><input id="user-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} /></div>
        <div className="field"><label htmlFor="user-role">Role</label>
          <select id="user-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Any</option><option value="freelancer">Freelancer</option><option value="client">Client</option>
            <option value="admin">Admin</option><option value="moderator">Moderator</option><option value="finance">Finance</option>
          </select>
        </div>
        <button className="btn" type="submit">Search</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="empty">No users match.</p>}
      {items && items.length > 0 && (
        <table>
          <thead><tr><th scope="col">Email</th><th scope="col">Roles</th><th scope="col">Joined</th><th scope="col">Security</th><th scope="col">State</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.roles.join(', ') || '—'}</td>
                <td>{when(u.created_at)}</td>
                <td>{u.mfa_enabled ? 'MFA on' : 'MFA off'}{u.email_verified === false ? ' · email not verified' : ''}</td>
                <td>{u.suspended ? <span className="badge s-lost">Suspended</span> : 'Active'}</td>
                <td><button className="btn" type="button" onClick={() => void open(u.id)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next && <button className="btn" type="button" onClick={() => void search(next)}>Load more</button>}

      {detail && (
        <div className="card" aria-label="User details">
          <div className="row between"><b>{detail.profile?.full_name || detail.user.email}</b><button className="link" type="button" onClick={() => setDetail(null)}>Close</button></div>
          <p className="muted">{detail.user.email} · ID {detail.user.id} · joined {when(detail.user.created_at)} · roles {detail.user.roles.join(', ') || 'none'}</p>
          <div className="stat-grid">{Object.entries(detail.counts).map(([k, v]) => <div className="stat" key={k}><div className="v">{v}</div><div className="l">{COUNT_LABELS[k] ?? k}</div></div>)}</div>
          {detail.organizations.length > 0 && <p>Organisations: {detail.organizations.map((o) => `${o.name} (${o.role}${o.status !== 'active' ? `, ${o.status}` : ''})`).join('; ')}</p>}
          <b>Suspensions</b>
          {detail.suspensions.length === 0 ? <p className="muted">None.</p> : <ul>{detail.suspensions.map((s) => <li key={s.id}>{when(s.created_at)}: {s.reason} — {s.status}{s.lifted_at ? `, lifted ${when(s.lifted_at)}` : ''}{s.appeal_status ? ` · appeal ${s.appeal_status}` : ''}</li>)}</ul>}
          <b>Staff actions involving this user</b>
          {detail.staff_actions.length === 0 ? <p className="muted">None.</p> : <ul>{detail.staff_actions.map((a, i) => <li key={i}>{when(a.created_at)}: {a.action} on {a.target_type}{a.note ? ` — ${a.note}` : ''}</li>)}</ul>}
          <p className="muted small">To suspend or review an appeal, use Trust and safety above: it records the reason and needs a second reviewer for appeals.</p>
        </div>
      )}
    </section>
  );
}

export function AuditLogPanel() {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (before?: string) => {
    setError('');
    try {
      const params = new URLSearchParams({ target_type: type, ...(before ? { before } : {}) });
      const r = await api<{ items: AuditItem[]; next_before: string | null; target_types: string[] }>(`/api/v1/admin/audit-log?${params.toString()}`);
      const list = Array.isArray(r?.items) ? r.items : [];
      setItems((prev) => (before && prev ? [...prev, ...list] : list));
      setNext(typeof r?.next_before === 'string' ? r.next_before : null);
      setTypes(Array.isArray(r?.target_types) ? r.target_types : []);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [type]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card" aria-labelledby="audit-heading">
      <h3 id="audit-heading">Audit log</h3>
      <p className="muted small">Every staff decision: moderation, reports, disputes, suspensions, appeals and feature flags. Append-only.</p>
      <div className="field"><label htmlFor="audit-type">Show</label>
        <select id="audit-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All actions</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="empty">No staff actions recorded.</p>}
      {items && items.length > 0 && (
        <table>
          <thead><tr><th scope="col">When</th><th scope="col">Staff member</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Note</th></tr></thead>
          <tbody>{items.map((a) => <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.actor_email ?? a.actor_user_id ?? 'system'}</td><td>{a.action}</td><td>{a.target_type} {a.target_id.slice(0, 8)}</td><td>{a.note || '—'}</td></tr>)}</tbody>
        </table>
      )}
      {next && <button className="btn" type="button" onClick={() => void load(next)}>Load more</button>}
    </section>
  );
}

export function HealthPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const h = await api<Health>('/api/v1/admin/health');
      if (h && h.migration && Array.isArray(h.configuration)) setHealth(h);
      else setError('Could not read system health.');
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card" aria-labelledby="health-heading">
      <div className="row between"><h3 id="health-heading">System health</h3><button className="btn" type="button" onClick={() => void load()}>Refresh</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {health && (
        <>
          <p>Version {health.version} · {health.environment} · database answered in {health.database.latency_ms} ms</p>
          <p className={health.migration.ok ? 'success' : 'error'}>
            {health.migration.ok
              ? `Database migrations are current (${health.migration.current}).`
              : health.migration.readable
                ? `Database is at ${health.migration.current ?? 'unknown'}; this release expects ${health.migration.expected}. Run the Neon migration workflow.`
                : `Migration version could not be read; this release expects ${health.migration.expected}.`}
          </p>
          <ul aria-label="Configuration checks">
            {health.configuration.map((c) => <li key={c.key}><span className={`badge ${c.ok ? 's-won' : 's-lost'}`}>{c.ok ? 'OK' : 'Needs setup'}</span> {c.detail}</li>)}
          </ul>
          <p className="muted">AI today: {health.ai_today.calls} calls, ${health.ai_today.cost_usd.toFixed(2)} estimated · Queues: {Object.entries(health.queues).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ')}</p>
        </>
      )}
    </section>
  );
}
