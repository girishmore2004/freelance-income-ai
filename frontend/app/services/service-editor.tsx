'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { PACKAGE_KEYS, PACKAGE_LABELS, emptyPackages, fieldErrors, formToPackages, packagesToForm, type PackageForm, type PackageKey, type ServicePackage } from '@/lib/services';

/**
 * Create or edit a service (U18): what you sell, in up to three packages.
 * Prices are set by the freelancer in rupees; the server checks every field
 * and screens the text before the service goes live.
 */

export type MyService = {
  id: string; category_slug: string; title: string; description: string; skills: string[]; packages: ServicePackage[]; requirements: string;
  status: string; from_price_minor: number; orders?: number; open_orders?: number; moderation_note?: string;
};
type Category = { slug: string; name: string };

export function ServiceEditor({ service, categories, onSaved, onCancel }: { service: MyService | null; categories: Category[]; onSaved: (s: MyService, message: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(service?.title ?? '');
  const [category, setCategory] = useState(service?.category_slug ?? categories[0]?.slug ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [skills, setSkills] = useState((service?.skills ?? []).join(', '));
  const [requirements, setRequirements] = useState(service?.requirements ?? '');
  const [packages, setPackages] = useState<Record<PackageKey, PackageForm>>(service ? packagesToForm(service.packages) : emptyPackages());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setPkg(key: PackageKey, patch: Partial<PackageForm>) {
    setPackages((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    const payload = {
      title, category_slug: category, description, requirements,
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      packages: formToPackages(packages),
    };
    try {
      const saved = service
        ? await api<MyService>(`/api/v1/services/${service.id}`, 'PUT', payload)
        : await api<MyService>('/api/v1/me/services', 'POST', payload);
      onSaved(saved, service ? 'Service saved.' : 'Draft saved. Publish it when you are ready.');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(fieldErrors(err.details));
        setError(err.message);
      } else setError('Could not save the service.');
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k] ? <span className="error small" id={`err-${k.replace(/\./g, '-')}`}>{errors[k]}</span> : null;
  const enabledKeys = PACKAGE_KEYS.filter((k) => packages[k].on);
  const keyIndex = (k: PackageKey) => enabledKeys.indexOf(k);

  return (
    <form className="card" aria-label={service ? 'Edit service' : 'New service'} onSubmit={save}>
      <h3>{service ? 'Edit service' : 'New service'}</h3>
      <div className="field"><label htmlFor="sv-title">Title</label><input id="sv-title" value={title} maxLength={120} placeholder="I will design a logo for your bakery" onChange={(e) => setTitle(e.target.value)} />{err('title')}</div>
      <div className="field"><label htmlFor="sv-cat">Category</label>
        <select id="sv-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>{err('category_slug')}</div>
      <div className="field"><label htmlFor="sv-desc">What you do (30–5,000 characters)</label><textarea id="sv-desc" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />{err('description')}</div>
      <div className="field"><label htmlFor="sv-skills">Skills (comma separated, up to 10)</label><input id="sv-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />{err('skills')}</div>
      <div className="field"><label htmlFor="sv-req">What the client must tell you when ordering (optional)</label><textarea id="sv-req" rows={2} maxLength={1000} value={requirements} onChange={(e) => setRequirements(e.target.value)} />{err('requirements')}</div>

      <fieldset>
        <legend>Packages</legend>
        <p className="muted small">Offer 1 to 3. Higher packages should not cost less. Minimum ₹100. Delivery 1–90 days.</p>
        {err('packages')}
        <div className="grid g3">
          {PACKAGE_KEYS.map((k) => {
            const f = packages[k];
            const at = `packages.${keyIndex(k)}`;
            return (
              <fieldset key={k} className="card item" aria-label={`${PACKAGE_LABELS[k]} package`}>
                <label className="row"><input type="checkbox" checked={f.on} onChange={() => setPkg(k, { on: !f.on })} /> Offer {PACKAGE_LABELS[k]}</label>
                {f.on && (
                  <>
                    <div className="field"><label htmlFor={`pk-${k}-name`}>{PACKAGE_LABELS[k]} name</label><input id={`pk-${k}-name`} value={f.name} maxLength={40} onChange={(e) => setPkg(k, { name: e.target.value })} />{err(`${at}.name`)}</div>
                    <div className="field"><label htmlFor={`pk-${k}-price`}>{PACKAGE_LABELS[k]} price (₹)</label><input id={`pk-${k}-price`} inputMode="decimal" value={f.price} onChange={(e) => setPkg(k, { price: e.target.value })} />{err(`${at}.price_minor`)}</div>
                    <div className="field"><label htmlFor={`pk-${k}-days`}>{PACKAGE_LABELS[k]} delivery days</label><input id={`pk-${k}-days`} type="number" min={1} max={90} value={f.days} onChange={(e) => setPkg(k, { days: e.target.value })} />{err(`${at}.delivery_days`)}</div>
                    <div className="field"><label htmlFor={`pk-${k}-rev`}>{PACKAGE_LABELS[k]} revisions</label><input id={`pk-${k}-rev`} type="number" min={0} max={10} value={f.revisions} onChange={(e) => setPkg(k, { revisions: e.target.value })} />{err(`${at}.revisions`)}</div>
                    <div className="field"><label htmlFor={`pk-${k}-del`}>{PACKAGE_LABELS[k]} deliverables (one per line)</label><textarea id={`pk-${k}-del`} rows={3} value={f.deliverables} onChange={(e) => setPkg(k, { deliverables: e.target.value })} />{err(`${at}.deliverables`)}</div>
                    <div className="field"><label htmlFor={`pk-${k}-desc`}>{PACKAGE_LABELS[k]} description (optional)</label><textarea id={`pk-${k}-desc`} rows={2} maxLength={600} value={f.description} onChange={(e) => setPkg(k, { description: e.target.value })} /></div>
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save service'}</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
