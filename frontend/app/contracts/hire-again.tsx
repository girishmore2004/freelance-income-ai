'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

/**
 * "Hire again" (U14): invite the freelancer from a completed contract to one
 * of the client account's open projects, even if they are not listed in
 * discovery (the server checks the completed contract).
 */

type Listing = { id: string; status: string; brief: { title: string } };

export function HireAgain({ organizationId, freelancerId }: { organizationId: string; freelancerId: string }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [listingId, setListingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Listing[]>(`/api/v1/organizations/${organizationId}/listings`)
      .then((r) => {
        const open = Array.isArray(r) ? r.filter((l) => ['published', 'hiring'].includes(l.status) && l.brief && typeof l.brief.title === 'string') : [];
        setListings(open);
        if (open[0]) setListingId(open[0].id);
      })
      .catch(() => setListings([]));
  }, [organizationId]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/listings/${listingId}/invitations`, 'POST', { freelancer_user_id: freelancerId, message });
      setNotice('Invitation sent. They will see it on their Find work page.');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  if (listings === null) return null;
  return (
    <section className="card" aria-label="Hire again">
      <b>Hire again</b>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {listings.length === 0 ? (
        <p className="muted">Publish a new project, then invite this freelancer to it from here. <a className="link" href="/client/projects">Post a project</a></p>
      ) : (
        <form onSubmit={invite}>
          <div className="field">
            <label htmlFor="hire-again-project">Invite to project</label>
            <select id="hire-again-project" value={listingId} onChange={(e) => setListingId(e.target.value)}>
              {listings.map((l) => <option key={l.id} value={l.id}>{l.brief.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hire-again-message">Message (optional)</label>
            <textarea id="hire-again-message" rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy || !listingId}>Send invitation</button>
        </form>
      )}
    </section>
  );
}
