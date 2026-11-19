'use client';

/** Client account (organisation) details: one form used on Account and on the Client profile page. */

export type Billing = { name: string; email: string; address: string; tax_id: string };
export type Organization = {
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
export type Identity = { user_id?: string; roles: string[]; organizations: Organization[]; client_side_enabled: boolean };
export type OrgForm = {
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

export const EMPTY_FORM: OrgForm = { name: '', kind: 'individual', industry: '', website: '', country: 'IN', billing_name: '', billing_email: '', billing_address: '', tax_id: '' };

export function formFrom(org: Organization): OrgForm {
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

export function OrgFields({ form, set, fieldErrors }: { form: OrgForm; set: (key: keyof OrgForm) => (event: { target: { value: string } }) => void; fieldErrors: Record<string, string> }) {
  return (
    <>
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
    </>
  );
}
