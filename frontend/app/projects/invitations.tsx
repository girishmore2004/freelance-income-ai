'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { formatBudget } from '@/lib/listing-format';

/**
 * Freelancer side of client discovery: the opt-in to be suggested to clients,
 * and invitations received from clients.
 */

type Visibility = { visible: boolean; visible_since: string | null; profile_complete: boolean; has_freelancer_role: boolean };
type InvitedProject = {
  title: string; client_name: string; outcome: string; budget_min_minor: number | null; budget_max_minor: number | null;
  currency: string; budget_model: string; deadline: string | null; skills: string[];
};
type Invitation = { id: string; status: string; message: string; created_at: string; listing_status: string; project: InvitedProject };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export function MarketplaceVisibility() {
  const [state, setState] = useState<Visibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Visibility>('/api/v1/me/marketplace-profile').then((v) => { if (v && typeof v.visible === 'boolean') setState(v); }).catch((e) => {
      if (!(e instanceof ApiError && e.code === 'FEATURE_DISABLED')) setError(messageOf(e));
    });
  }, []);

  async function toggle() {
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      const next = await api<Visibility>('/api/v1/me/marketplace-profile', 'PUT', { visible: !state.visible });
      setState({ ...state, ...next });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!state && !error) return null;
  return (
    <section className="card" aria-labelledby="visibility-heading">
      <h3 id="visibility-heading">Be suggested to clients</h3>
      {state && (
        <>
          <p className="muted">
            {state.visible
              ? 'Clients can see your name, headline, skills, services, rate, hours and timezone in their project suggestions. Never your email or links.'
              : 'You are hidden. Turn this on to appear in clients’ suggested freelancers and receive invitations.'}
          </p>
          {!state.profile_complete && !state.visible && <p className="muted">Add your name and at least one skill to your profile first.</p>}
          <label className="row">
            <input type="checkbox" checked={state.visible} disabled={busy || (!state.visible && (!state.profile_complete || !state.has_freelancer_role))} onChange={() => void toggle()} />
            <span>Show my profile to clients</span>
          </label>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function Invitations() {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api<Invitation[]>('/api/v1/me/invitations');
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'FEATURE_DISABLED')) setError(messageOf(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function respond(inv: Invitation, response: 'accept' | 'decline') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/me/invitations/${inv.id}/respond`, 'POST', { response });
      setNotice(response === 'accept' ? 'Invitation accepted. Proposals for client projects open with the hiring workflow.' : 'Invitation declined');
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!items || (items.length === 0 && !error)) return null;
  return (
    <section aria-labelledby="invitations-heading">
      <h3 id="invitations-heading">Invitations from clients</h3>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {items.map((inv) => (
        <article className="card item" key={inv.id}>
          <div className="row between"><b>{inv.project.title}</b><span className="badge">{inv.status}</span></div>
          <p className="muted">{inv.project.client_name} · {formatBudget(inv.project.budget_min_minor, inv.project.budget_max_minor, inv.project.currency, inv.project.budget_model)} · {inv.project.deadline ? `Deadline ${inv.project.deadline}` : 'No deadline set'}</p>
          <p>{inv.project.outcome}</p>
          {inv.message && <blockquote>{inv.message}</blockquote>}
          {inv.status === 'pending' && ['published', 'hiring'].includes(inv.listing_status) && (
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void respond(inv, 'accept')}>Accept</button>
              <button className="btn" disabled={busy} onClick={() => void respond(inv, 'decline')}>Decline</button>
            </div>
          )}
          {inv.status === 'pending' && !['published', 'hiring'].includes(inv.listing_status) && <p className="muted">This project is no longer taking proposals.</p>}
        </article>
      ))}
    </section>
  );
}
