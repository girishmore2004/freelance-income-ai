'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { EMPTY_FORM, OrgFields, formFrom, type Identity, type OrgForm } from '../../account/org-form';
import { RequiredNote } from '../../onboarding-ui';
import { billingGaps, clientGaps } from '@/lib/onboarding';

/**
 * Client profile: the details freelancers and invoices see for the client account
 * (name, individual or company, industry, website, country, billing). Every client
 * gets an individual account automatically, so this page edits it; nothing to set up first.
 */
export default function ClientProfilePage() {
  const [token] = useSessionToken();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [orgId, setOrgId] = useState('');
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (keep?: string) => {
    try {
      const i = await api<Identity>('/api/v1/me/identity');
      const ok = i && Array.isArray(i.organizations) ? i : null;
      setIdentity(ok);
      const pick = ok?.organizations.find((o) => o.id === keep) ?? ok?.organizations[0];
      if (pick) { setOrgId(pick.id); setForm(formFrom(pick)); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your client profile.');
    }
  }, []);
  useEffect(() => { if (token) void load(); }, [token, load]);

  const org = identity?.organizations.find((o) => o.id === orgId) ?? null;
  const canEdit = org ? org.membership_role === 'owner' || org.membership_role === 'admin' : false;
  const set = (key: keyof OrgForm) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!org) return;
    setBusy(true); setError(''); setNotice(''); setFieldErrors({});
    try {
      await api(`/api/v1/organizations/${org.id}`, 'PATCH', { ...form });
      setNotice('Client profile saved.');
      await load(org.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_ORGANIZATION') {
        const first = e.details[0];
        setFieldErrors(first && typeof first === 'object' ? (first as Record<string, string>) : {});
        setError('Check the highlighted fields.');
      } else setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <main className="shell"><div className="card"><h2>Client profile</h2><p className="muted">Sign in first.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  return (
    <main className="shell" aria-busy={busy || undefined}>
      <h2>Client profile</h2>
      <p className="muted">How you appear to freelancers on your projects and offers, and the details used on invoices and statements.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {!identity && !error && <p className="muted">Loading…</p>}
      {identity && !identity.roles.includes('client') && (
        <div className="card"><p>Hiring is not on for your account yet. Use “+ Client” in the top bar to start hiring.</p></div>
      )}
      {identity && identity.roles.includes('client') && identity.organizations.length === 0 && (
        <div className="card"><p className="muted">{identity.client_side_enabled ? 'Your client profile is being prepared. Reload in a moment.' : 'Hiring opens when the client marketplace launches.'}</p></div>
      )}
      {identity && identity.organizations.length > 1 && (
        <div className="field">
          <label htmlFor="cp-org">Client account</label>
          <select id="cp-org" value={orgId} onChange={(e) => { const o = identity.organizations.find((x) => x.id === e.target.value); if (o) { setOrgId(o.id); setForm(formFrom(o)); setNotice(''); setFieldErrors({}); } }}>
            {identity.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
      {org && (
        canEdit ? (
          <form className="card" onSubmit={save} aria-label="Client profile details" noValidate>
            <RequiredNote text="needed for a complete profile (you can save at any time)" />
            {(() => {
              const gaps = clientGaps(form);
              const billing = billingGaps(form);
              return gaps.length
                ? <p className="setup-warning" role="status">Still needed for a complete profile: {gaps.map((g) => g.label).join(', ')}.</p>
                : <p className="success" role="status">Your client profile is complete.{billing.length ? ` Add ${billing.map((g) => g.label.toLowerCase()).join(' and ')} before your first payment.` : ''}</p>;
            })()}
            <OrgFields form={form} set={set} fieldErrors={fieldErrors} />
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy || form.name.trim().length < 2}>{busy ? 'Saving…' : 'Save client profile'}</button>
              <a className="link" href="/account">Team and more client accounts</a>
            </div>
          </form>
        ) : (
          <div className="card">
            <p><b>{org.name}</b> <span className="badge">{org.kind === 'company' ? 'Company' : 'Individual'}</span></p>
            <p className="muted">{[org.industry, org.country, org.website].filter(Boolean).join(' · ') || 'No details yet'}</p>
            <p className="muted small">You are a team member here; the owner or an admin can change these details.</p>
          </div>
        )
      )}
    </main>
  );
}
