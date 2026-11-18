'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { PlanCard } from './plan-card';
import { SuspensionCard } from './suspension-card';
import { VerificationCard } from './verification-card';
import { MyInvitations, TeamPanel } from './team-panel';

/**
 * Account & roles (Phase 1). One login, two public roles:
 * "Find work" (freelancer) and "Hire" (client). Client accounts are
 * organisations (individual or company) that hold the billing identity.
 * Data comes from GET /api/v1/me/identity; nothing here is mocked.
 */

type Billing = { name: string; email: string; address: string; tax_id: string };
type Organization = {
  id: string;
  name: string;
  kind: 'individual' | 'company';
  industry: string;
  website: string;
  country: string;
  preferred_language: string;
  status: string;
  membership_role: 'owner' | 'admin' | 'member';
  billing?: Billing;
};
type Identity = { user_id?: string; roles: string[]; organizations: Organization[]; client_side_enabled: boolean };
type OrgForm = {
  name: string;
  kind: 'individual' | 'company';
  industry: string;
  website: string;
  country: string;
  billing_name: string;
  billing_email: string;
  billing_address: string;
  tax_id: string;
};

const EMPTY_FORM: OrgForm = { name: '', kind: 'individual', industry: '', website: '', country: 'IN', billing_name: '', billing_email: '', billing_address: '', tax_id: '' };

const ROLE_INFO: Record<'freelancer' | 'client', { title: string; description: string }> = {
  freelancer: { title: 'Find work', description: 'Discover projects, draft proposals and deliver work.' },
  client: { title: 'Hire freelancers', description: 'Create a client account, post projects and hire.' },
};

function formFrom(org: Organization): OrgForm {
  return {
    name: org.name,
    kind: org.kind,
    industry: org.industry,
    website: org.website,
    country: org.country,
    billing_name: org.billing?.name ?? '',
    billing_email: org.billing?.email ?? '',
    billing_address: org.billing?.address ?? '',
    tax_id: org.billing?.tax_id ?? '',
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function AccountPage() {
  const [token] = useSessionToken();
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

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleRole(role: 'freelancer' | 'client', active: boolean) {
    void run(async () => {
      const result = active
        ? await api<{ message: string }>(`/api/v1/me/roles/${role}`, 'DELETE')
        : await api<{ message: string }>('/api/v1/me/roles', 'POST', { role });
      return result.message;
    });
  }

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
          <h2>Account &amp; roles</h2>
          <p className="muted">Sign in first, then open this page to manage your roles and client accounts.</p>
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
        <h2>Account &amp; roles</h2>
        <a className="link" href="/workspace">← Back to workspace</a>
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
          <VerificationCard />
          <section className="card" aria-labelledby="roles-heading">
            <h3 id="roles-heading">Your roles</h3>
            <p className="muted">One login can both find work and hire. Your freelancer and client records stay separate.</p>
            <div className="grid">
              {(['freelancer', 'client'] as const).map((role) => {
                const active = roles.includes(role);
                const locked = role === 'client' && !active && !clientSideEnabled;
                return (
                  <div className="card item" key={role}>
                    <div className="row between">
                      <b>{ROLE_INFO[role].title}</b>
                      <span className={`badge${active ? ' ok' : ''}`}>{active ? 'Active' : 'Off'}</span>
                    </div>
                    <p className="muted">{ROLE_INFO[role].description}</p>
                    {locked ? (
                      <p className="muted">Hiring opens when the client marketplace launches.</p>
                    ) : (
                      <button className={`btn${active ? '' : ' primary'}`} disabled={busy} onClick={() => toggleRole(role, active)}>
                        {active ? 'Switch off' : 'Turn on'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {isClient && (
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
                  <div className="field">
                    <label htmlFor="org-kind">Account type</label>
                    <select id="org-kind" value={form.kind} onChange={set('kind')}>
                      <option value="individual">Individual</option>
                      <option value="company">Company</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="org-name">{form.kind === 'company' ? 'Company name' : 'Your name'} (required)</label>
                    <input id="org-name" value={form.name} onChange={set('name')} required minLength={2} maxLength={160} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'org-name-error' : undefined} />
                    {fieldErrors.name && <p className="error" id="org-name-error">{fieldErrors.name}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-industry">Industry</label>
                    <input id="org-industry" value={form.industry} onChange={set('industry')} maxLength={120} aria-invalid={Boolean(fieldErrors.industry)} aria-describedby={fieldErrors.industry ? 'org-industry-error' : undefined} />
                    {fieldErrors.industry && <p className="error" id="org-industry-error">{fieldErrors.industry}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-website">Website (https://…)</label>
                    <input id="org-website" type="url" value={form.website} onChange={set('website')} maxLength={300} placeholder="https://" aria-invalid={Boolean(fieldErrors.website)} aria-describedby={fieldErrors.website ? 'org-website-error' : undefined} />
                    {fieldErrors.website && <p className="error" id="org-website-error">{fieldErrors.website}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-country">Country code</label>
                    <input id="org-country" value={form.country} onChange={set('country')} maxLength={2} placeholder="IN" aria-invalid={Boolean(fieldErrors.country)} aria-describedby={fieldErrors.country ? 'org-country-error' : undefined} />
                    {fieldErrors.country && <p className="error" id="org-country-error">{fieldErrors.country}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-billing-name">Billing name</label>
                    <input id="org-billing-name" value={form.billing_name} onChange={set('billing_name')} maxLength={200} aria-invalid={Boolean(fieldErrors.billing_name)} aria-describedby={fieldErrors.billing_name ? 'org-billing-name-error' : undefined} />
                    {fieldErrors.billing_name && <p className="error" id="org-billing-name-error">{fieldErrors.billing_name}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-billing-email">Billing email</label>
                    <input id="org-billing-email" type="email" value={form.billing_email} onChange={set('billing_email')} maxLength={320} aria-invalid={Boolean(fieldErrors.billing_email)} aria-describedby={fieldErrors.billing_email ? 'org-billing-email-error' : undefined} />
                    {fieldErrors.billing_email && <p className="error" id="org-billing-email-error">{fieldErrors.billing_email}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-billing-address">Billing address</label>
                    <input id="org-billing-address" value={form.billing_address} onChange={set('billing_address')} maxLength={1000} aria-invalid={Boolean(fieldErrors.billing_address)} aria-describedby={fieldErrors.billing_address ? 'org-billing-address-error' : undefined} />
                    {fieldErrors.billing_address && <p className="error" id="org-billing-address-error">{fieldErrors.billing_address}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="org-tax">Tax ID (for example GSTIN), optional</label>
                    <input id="org-tax" value={form.tax_id} onChange={set('tax_id')} maxLength={40} aria-invalid={Boolean(fieldErrors.tax_id)} aria-describedby={fieldErrors.tax_id ? 'org-tax-error' : undefined} />
                    {fieldErrors.tax_id && <p className="error" id="org-tax-error">{fieldErrors.tax_id}</p>}
                  </div>
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

      {!loading && !identity && !error && <p className="muted">No account data.</p>}
      {!identity && error && (
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Try again
        </button>
      )}
    </main>
  );
}
