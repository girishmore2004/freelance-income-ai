'use client';
import { BackToWorkspace } from '../back-to-workspace';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { PlanCard } from './plan-card';
import { SuspensionCard } from './suspension-card';
import { VerificationCard } from './verification-card';
import { MyInvitations, TeamPanel } from './team-panel';
import { BlocksPanel } from './blocks-panel';
import { EMPTY_FORM, OrgFields, formFrom, type Identity, type OrgForm } from './org-form';
import { ROLES_EVENT, useWorkspace } from '@/lib/mode';

/**
 * Account (Phase 1). One login, two public roles (sides are added from the top switch):
 * "Find work" (freelancer) and "Hire" (client). Client accounts are
 * organisations (individual or company) that hold the billing identity.
 * Data comes from GET /api/v1/me/identity; nothing here is mocked.
 */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function AccountPage() {
  const [token] = useSessionToken();
  // Account-wide parts (plan, invitations) show everywhere; side parts follow the active portal.
  const workspace = useWorkspace();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setIdentity(await api<Identity>('/api/v1/me/identity'));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);
  // Sides are added from the top switch; reload so the client part appears at once.
  useEffect(() => {
    const onRole = () => { void load(); };
    window.addEventListener(ROLES_EVENT, onRole);
    return () => window.removeEventListener(ROLES_EVENT, onRole);
  }, [load]);

  async function saveOrganization(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = { ...form };
      if (editingId) {
        await api(`/api/v1/organizations/${editingId}`, 'PATCH', payload);
        setNotice('Client account updated.');
      } else {
        await api('/api/v1/organizations', 'POST', payload);
        setNotice('Client account created.');
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_ORGANIZATION') {
        const first = e.details[0];
        setFieldErrors(first && typeof first === 'object' ? (first as Record<string, string>) : {});
        setError('Check the highlighted fields.');
      } else {
        setError(messageOf(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="shell">
        <div className="card">
          <h2>Account</h2>
          <p className="muted">Sign in first, then open this page to manage your account and client accounts.</p>
          <a className="btn" href="/">Go to sign in</a>
        </div>
      </main>
    );
  }

  const roles = identity?.roles ?? [];
  const isClient = roles.includes('client');
  const clientSideEnabled = identity?.client_side_enabled ?? false;
  const set = (key: keyof OrgForm) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <main className="shell">
      <div className="row between">
        <h2>Account</h2>
        <BackToWorkspace />
      </div>

      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {loading && !identity && <p className="muted">Loading your account…</p>}

      {identity && (
        <>
          <SuspensionCard />
          <MyInvitations onJoined={() => void load()} />
          <PlanCard />
          {workspace !== 'admin' && <VerificationCard side={workspace} />}

          {workspace === 'freelancer' && isClient && <p className="muted small">Your client accounts and team are on the Client side (switch at the top).</p>}
          {workspace === 'client' && isClient && (
            <section className="card" aria-labelledby="orgs-heading">
              <h3 id="orgs-heading">Client accounts</h3>
              <p className="muted">Projects and invoices will belong to a client account. Use an individual account for yourself, or a company account for a business.</p>

              {identity.organizations.length === 0 && <p className="empty">You have no client accounts yet. Create one below.</p>}

              {identity.organizations.map((org) => (
                <div className="card item" key={org.id}>
                  <div className="row between">
                    <b>{org.name}</b>
                    <span className="badge">{org.kind === 'company' ? 'Company' : 'Individual'} · {org.membership_role}</span>
                  </div>
                  <p className="muted">{[org.industry, org.country, org.website].filter(Boolean).join(' · ') || 'No details yet'}</p>
                  {org.billing && (
                    <p className="muted">
                      Billing: {org.billing.name || 'name not set'}
                      {org.billing.email ? ` · ${org.billing.email}` : ''}
                      {org.billing.tax_id ? ` · Tax ID ${org.billing.tax_id}` : ''}
                    </p>
                  )}
                  <a className="btn" href="/client/projects">Manage projects</a>
                  {(org.membership_role === 'owner' || org.membership_role === 'admin') && (
                    <button className="btn" disabled={busy} onClick={() => { setEditingId(org.id); setForm(formFrom(org)); setNotice(''); setError(''); }}>
                      Edit
                    </button>
                  )}
                  {identity.user_id && (
                    <TeamPanel organizationId={org.id} myRole={org.membership_role} myUserId={identity.user_id} onLeft={() => void load()} />
                  )}
                </div>
              ))}

              {clientSideEnabled || editingId ? (
                <form className="card" onSubmit={saveOrganization} aria-labelledby="org-form-heading" noValidate>
                  <h3 id="org-form-heading">{editingId ? 'Edit client account' : 'New client account'}</h3>
                  <OrgFields form={form} set={set} fieldErrors={fieldErrors} />
                  <div className="row">
                    <button className="btn primary" type="submit" disabled={busy || form.name.trim().length < 2}>
                      {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create client account'}
                    </button>
                    {editingId && (
                      <button className="btn" type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <p className="muted">Creating new client accounts opens when the client marketplace launches.</p>
              )}
            </section>
          )}
        </>
      )}

      {identity && workspace !== 'admin' && <BlocksPanel side={workspace} />}

      {!loading && !identity && !error && <p className="muted">No account data.</p>}
      {!identity && error && (
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Try again
        </button>
      )}
    </main>
  );
}
