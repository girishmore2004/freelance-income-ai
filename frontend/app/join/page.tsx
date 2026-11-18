'use client';
import { useEffect, useState } from 'react';
import { api, useSessionToken } from '@/lib/api-client';

/**
 * Join a client account from a one-time invitation link (/join?token=…).
 * The signed-in email must match the invitation. The token stays in the
 * address bar only; it is sent to the API and never stored.
 */

type Preview = { organization_name: string; role: string; email_matches: boolean; expires_at: string };

function readToken(): string {
  if (typeof window === 'undefined') return '';
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  return /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : '';
}

export default function JoinPage() {
  const [token] = useSessionToken();
  const [inviteToken, setInviteToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setInviteToken(readToken()); }, []);

  useEffect(() => {
    if (!token || !inviteToken) return;
    api<Preview>(`/api/v1/organization-invitations/preview?token=${encodeURIComponent(inviteToken)}`)
      .then((p) => { if (p && typeof p.organization_name === 'string') setPreview(p); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'This invitation is not valid.'));
  }, [token, inviteToken]);

  async function accept() {
    setBusy(true);
    setError('');
    try {
      await api('/api/v1/organization-invitations/accept', 'POST', { token: inviteToken });
      setJoined(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="join-heading">
        <h2 id="join-heading">Join a team</h2>
        {!inviteToken && <p className="error" role="alert">This link is incomplete. Ask the account owner to send it again.</p>}
        {inviteToken && !token && (
          <>
            <p>Sign in (or create an account) with the email address the invitation was sent to, then open this link again.</p>
            <a className="btn primary" href="/">Sign in</a>
          </>
        )}
        <div aria-live="polite">{error && <p className="error" role="alert">{error}</p>}</div>
        {preview && !joined && (
          <>
            <p>You are invited to join <b>{preview.organization_name}</b> as <b>{preview.role}</b>.</p>
            <p className="muted">{preview.role === 'admin' ? 'Admins can post projects, hire, fund milestones and manage the team.' : 'Members can see and work on the account’s projects and contracts.'} The link expires on {new Date(preview.expires_at).toLocaleDateString()}.</p>
            {preview.email_matches
              ? <button className="btn primary" type="button" disabled={busy} onClick={() => void accept()}>Join {preview.organization_name}</button>
              : <p className="error" role="alert">You are signed in with a different email address. Sign out and sign in with the invited address.</p>}
          </>
        )}
        {joined && (
          <>
            <p className="success">You joined {preview?.organization_name}.</p>
            <a className="btn primary" href="/client/projects">Open projects</a> <a className="btn" href="/account">Account</a>
          </>
        )}
      </section>
    </main>
  );
}
