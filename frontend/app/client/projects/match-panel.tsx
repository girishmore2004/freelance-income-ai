'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';

/**
 * Suggested freelancers (Match and Shortlist agent C2) and invitations for one
 * listing. Scores are deterministic and every point is explained. Only
 * freelancers who chose to be visible to clients appear.
 */

export type FreelancerCard = {
  user_id: string; display_name: string; headline: string; skills: string[]; services: string[];
  hourly_rate: number | null; currency: string; weekly_hours: number | null; timezone: string; newcomer: boolean;
};
type Match = {
  freelancer: FreelancerCard; score: number; reasons: string[]; missing_skills: string[]; newcomer_slot: boolean;
  invitation_status: string | null; saved: boolean;
};
type Matches = { candidates_considered: number; matches: Match[] };
type Invitation = { id: string; status: string; message: string; created_at: string; freelancer: FreelancerCard };

const INVITE_LABEL: Record<string, string> = { pending: 'Invited', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn' };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export function MatchPanel({ listingId, organizationId, canInvite, invitable }: { listingId: string; organizationId: string; canInvite: boolean; invitable: boolean }) {
  const [data, setData] = useState<Matches | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [m, inv] = await Promise.all([
        api<Matches>(`/api/v1/listings/${listingId}/matches`),
        api<Invitation[]>(`/api/v1/listings/${listingId}/invitations`),
      ]);
      setData(m);
      setInvitations(inv);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [listingId]);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<{ message?: string } | unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(done);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MESSAGE_NOT_ALLOWED') setError(e.message);
      else setError(messageOf(e));
      setBusy(false);
    }
  }

  const invite = (m: Match) => run(
    () => api(`/api/v1/listings/${listingId}/invitations`, 'POST', { freelancer_user_id: m.freelancer.user_id, message, match_score: m.score }),
    `Invitation sent to ${m.freelancer.display_name}`,
  );
  const save = (m: Match) => run(
    () => m.saved
      ? api(`/api/v1/organizations/${organizationId}/saved-freelancers/${m.freelancer.user_id}`, 'DELETE')
      : api(`/api/v1/organizations/${organizationId}/saved-freelancers`, 'POST', { freelancer_user_id: m.freelancer.user_id }),
    m.saved ? 'Removed from saved freelancers' : `${m.freelancer.display_name} saved`,
  );
  const withdraw = (inv: Invitation) => run(
    () => api(`/api/v1/listings/${listingId}/invitations/${inv.id}/withdraw`, 'POST'),
    'Invitation withdrawn',
  );

  return (
    <section className="card" aria-label="Suggested freelancers">
      <div className="row between">
        <b>Suggested freelancers</b>
        <button className="btn" type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {data && (
        <p className="muted">
          Ranked {data.candidates_considered} freelancer{data.candidates_considered === 1 ? '' : 's'} who chose to be visible to clients.
          Scores are rule-based (skills, budget fit, category, availability, timezone); new freelancers get up to two places.
        </p>
      )}
      {canInvite && invitable && (
        <div className="field">
          <label htmlFor={`invite-message-${listingId}`}>Invitation message (optional, sent with each invitation)</label>
          <textarea id={`invite-message-${listingId}`} rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why you think they fit. Keep contact and payment on the platform." />
        </div>
      )}
      {!invitable && <p className="muted">Publish the listing (public or invite-only) to send invitations.</p>}
      {data && data.matches.length === 0 && <p className="empty">No visible freelancers match this project yet.</p>}
      {data?.matches.map((m) => (
        <div className="card item" key={m.freelancer.user_id}>
          <div className="row between">
            <span><b>{m.freelancer.display_name}</b>{m.freelancer.newcomer && <span className="badge"> New</span>}</span>
            <span className="badge" aria-label={`Match score ${m.score} out of 100`}>{m.score}/100</span>
          </div>
          {m.freelancer.headline && <p className="muted">{m.freelancer.headline}</p>}
          <ul>{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {m.missing_skills.length > 0 && <p className="muted">Not listed: {m.missing_skills.join(', ')}</p>}
          <div className="row">
            {m.invitation_status && m.invitation_status !== 'withdrawn'
              ? <span className="badge">{INVITE_LABEL[m.invitation_status] ?? m.invitation_status}</span>
              : canInvite && invitable && <button className="btn primary" type="button" disabled={busy} onClick={() => void invite(m)}>Invite to propose</button>}
            <button className="btn" type="button" disabled={busy} onClick={() => void save(m)}>{m.saved ? 'Unsave' : 'Save'}</button>
          </div>
        </div>
      ))}

      {invitations.length > 0 && (
        <>
          <b>Invitations sent</b>
          <ul>
            {invitations.map((inv) => (
              <li key={inv.id}>
                {inv.freelancer.display_name}: {INVITE_LABEL[inv.status] ?? inv.status}
                {canInvite && (inv.status === 'pending' || inv.status === 'accepted') && (
                  <> <button className="link" type="button" disabled={busy} onClick={() => void withdraw(inv)}>Withdraw</button></>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function SavedFreelancers({ organizationId }: { organizationId: string }) {
  const [items, setItems] = useState<{ freelancer: FreelancerCard; note: string; saved_at: string }[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await api(`/api/v1/organizations/${organizationId}/saved-freelancers`));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function remove(userId: string) {
    try {
      await api(`/api/v1/organizations/${organizationId}/saved-freelancers/${userId}`, 'DELETE');
      await load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <section aria-labelledby="saved-heading">
      <h3 id="saved-heading">Saved freelancers</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="empty">Save freelancers from a project’s suggestions to find them again here.</p>}
      {items?.map((s) => (
        <div className="card item" key={s.freelancer.user_id}>
          <div className="row between"><b>{s.freelancer.display_name}</b><button className="link" type="button" onClick={() => void remove(s.freelancer.user_id)}>Remove</button></div>
          <p className="muted">{s.freelancer.headline}{s.freelancer.skills.length ? ` · ${s.freelancer.skills.slice(0, 6).join(', ')}` : ''}</p>
          {s.note && <p>{s.note}</p>}
        </div>
      ))}
    </section>
  );
}
