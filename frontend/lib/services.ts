/**
 * Pure helpers for the service catalogue (U18): package forms, totals and
 * labels. Prices are entered in rupees and sent in paise (minor units).
 */

export const PACKAGE_KEYS = ['basic', 'standard', 'premium'] as const;
export type PackageKey = (typeof PACKAGE_KEYS)[number];
export const PACKAGE_LABELS: Record<PackageKey, string> = { basic: 'Basic', standard: 'Standard', premium: 'Premium' };

export type ServicePackage = { key: PackageKey; name: string; description: string; price_minor: number; delivery_days: number; revisions: number; deliverables: string[] };
export type PackageForm = { on: boolean; name: string; description: string; price: string; days: string; revisions: string; deliverables: string };

export const SERVICE_STATUS: Record<string, string> = {
  draft: 'Draft', in_review: 'Waiting for review', published: 'Live', paused: 'Paused', removed: 'Removed',
};

export function emptyPackages(): Record<PackageKey, PackageForm> {
  return {
    basic: { on: true, name: 'Basic', description: '', price: '', days: '3', revisions: '1', deliverables: '' },
    standard: { on: false, name: 'Standard', description: '', price: '', days: '5', revisions: '2', deliverables: '' },
    premium: { on: false, name: 'Premium', description: '', price: '', days: '7', revisions: '3', deliverables: '' },
  };
}

/** Saved packages back into the form (rupees, one deliverable per line). */
export function packagesToForm(packages: ServicePackage[]): Record<PackageKey, PackageForm> {
  const form = emptyPackages();
  for (const k of PACKAGE_KEYS) form[k].on = false;
  for (const p of packages) {
    if (!PACKAGE_KEYS.includes(p.key)) continue;
    form[p.key] = { on: true, name: p.name, description: p.description, price: String(p.price_minor / 100), days: String(p.delivery_days), revisions: String(p.revisions), deliverables: p.deliverables.join('\n') };
  }
  return form;
}

/** Ticked packages as the API expects them. Rupee amounts become paise (rounded to whole paise). */
export function formToPackages(form: Record<PackageKey, PackageForm>): ServicePackage[] {
  return PACKAGE_KEYS.filter((k) => form[k].on).map((k) => {
    const f = form[k];
    const rupees = Number(f.price.replace(/[,\s₹]/g, ''));
    return {
      key: k,
      name: f.name.trim(),
      description: f.description.trim(),
      price_minor: Number.isFinite(rupees) ? Math.round(rupees * 100) : 0,
      delivery_days: Number(f.days),
      revisions: Number(f.revisions),
      deliverables: f.deliverables.split('\n').map((d) => d.trim()).filter(Boolean),
    };
  });
}

/** "3 days" / "1 day". */
export function daysLabel(n: number | null | undefined): string {
  if (!n) return '';
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** Field errors from the API (`details[0]`) as a flat map with friendly keys. */
export function fieldErrors(details: unknown[] | undefined): Record<string, string> {
  const first = details && details[0] && typeof details[0] === 'object' ? (details[0] as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(first)) if (typeof v === 'string') out[k] = v;
  return out;
}
