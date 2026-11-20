'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

/**
 * Team of one client account: members, roles, invitations (one-time join
 * links), removal, leaving and ownership transfer. Owners invite admins and
 * members; admins invite members. Email delivery is not connected yet, so the
 * person who invites copies the link and sends it themselves.
 */

type Member = { user_id: string; email: string; role: 'owner' | 'admin' | 'member'; joined_at: string };
type Invitation = { id: string; email: string; role: string; status: string; expires_at: string };

export function TeamPanel({ organizationId, myRole, myUserId, onLeft }: { organizationId: string; myRole: 'owner' | 'admin' | 'member'; myUserId: string; onLeft: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  const load = useCallback(async () => {
    try {
      const m = await api<Member[]>(`/api/v1/organizations/${organizationId}/members`);
      setMembers(Array.isArray(m) ? m : []);
      if (canManage) {
        const i = await api<Invitation[]>(`/api/v1/organizations/${organizationId}/invitations`);
        setInvitations(Array.isArray(i) ? i : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the team.');
    }
  }, [organizationId, canManage]);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setLink('');
    setCopied(false);
    await run(async () => {
      const result = await api<{ join_path: string }>(`/api/v1/organizations/${organizationId}/invitations`, 'POST', { email, role });
      if (result && typeof result.join_path === 'string') setLink(`${window.location.origin}${result.join_path}`);
      setEmail('');
    }, 'Invitation created. Copy the link below and send it to the person.');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details aria-busy={busy || undefined} className="item">
      <summary>Team ({members.length || '…'})</summary>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      <ul aria-label="Members">
        {members.map((m) => (
          <li key={m.user_id}>
            {m.email} <span className="badge">{m.role}</span>{m.user_id === myUserId ? ' (you)' : ''}
            {isOwner && m.role !== 'owner' && (
              <>
                {' '}
                <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/organizations/${organizationId}/members/${m.user_id}/role`, 'POST', { role: m.role === 'admin' ? 'member' : 'admin' }), 'Role changed')}>
                  {m.role === 'admin' ? 'Make member' : 'Make admin'}
                </button>{' '}
                <button className="link" type="button" disabled={busy} onClick={() => { if (window.confirm(`Make ${m.email} the owner? You will become an admin.`)) void run(() => api(`/api/v1/organizations/${organizationId}/transfer-ownership`, 'POST', { user_id: m.user_id }), 'Ownership transferred. You are now an admin.').then((ok) => { if (ok) onLeft(); }); }}>
                  Make owner
                </button>
              </>
            )}
            {m.role !== 'owner' && m.user_id !== myUserId && (isOwner || (myRole === 'admin' && m.role === 'member')) && (
              <>
                {' '}
                <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/organizations/${organizationId}/members/${m.user_id}/remove`, 'POST', {}), 'Member removed')}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {myRole !== 'owner' && (
        <button className="btn" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/organizations/${organizationId}/members/${myUserId}/remove`, 'POST', {}), 'You left the account').then((ok) => { if (ok) onLeft(); })}>Leave this account</button>
      )}
      {canManage && (
        <>
          <form className="row" onSubmit={(e) => void invite(e)}>
            <div className="field">
              <label htmlFor={`invite-email-${organizationId}`}>Invite by email</label>
              <input id={`invite-email-${organizationId}`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`invite-role-${organizationId}`}>Role for the invited person</label>
              <select id={`invite-role-${organizationId}`} value={role} onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'member')}>
                <option value="member">Member (works on projects)</option>
                {isOwner && <option value="admin">Admin (also hires, pays and manages the team)</option>}
              </select>
            </div>
            <button className="btn primary" type="submit" disabled={busy || !email.includes('@')}>Create invitation</button>
          </form>
          {link && (
            <div className="item">
              <label htmlFor={`invite-link-${organizationId}`}>Join link (shown once; expires in 7 days; only works for that email)</label>
              <input id={`invite-link-${organizationId}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
          )}
          {invitations.length > 0 && (
            <ul aria-label="Pending invitations">
              {invitations.map((i) => (
                <li key={i.id}>
                  {i.email} <span className="badge">{i.role}</span> <span className="muted">{i.status === 'expired' ? 'expired' : `expires ${new Date(i.expires_at).toLocaleDateString()}`}</span>{' '}
                  <button className="link" type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/organizations/${organizationId}/invitations/${i.id}/revoke`, 'POST', {}), 'Invitation revoked')}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  );
}

type MyInvitation = { id: string; organization_name: string; role: string; expires_at: string };

/** Invitations addressed to the signed-in person's verified email. */
export function MyInvitations({ onJoined }: { onJoined: () => void }) {
  const [items, setItems] = useState<MyInvitation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ items: MyInvitation[] }>('/api/v1/me/organization-invitations');
      setItems(result && Array.isArray(result.items) ? result.items : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function answer(id: string, action: 'accept' | 'decline') {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/organization-invitations/${id}/${action}`, 'POST', {});
      await load();
      if (action === 'accept') onJoined();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!items.length) return null;
  return (
    <section aria-busy={busy || undefined} className="card" aria-labelledby="my-invites-heading">
      <h3 id="my-invites-heading">Team invitations for you</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {items.map((i) => (
        <div className="item row between" key={i.id}>
          <span><b>{i.organization_name}</b> <span className="badge">{i.role}</span></span>
          <span className="row">
            <button className="btn primary" disabled={busy} onClick={() => void answer(i.id, 'accept')}>Join</button>
            <button className="btn" disabled={busy} onClick={() => void answer(i.id, 'decline')}>Decline</button>
          </span>
        </div>
      ))}
    </section>
  );
}
