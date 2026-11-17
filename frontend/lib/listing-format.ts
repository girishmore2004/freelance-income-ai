/** Shared helpers for project listing pages (money is stored in minor units). */

export function rupeesToMinor(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

export function minorToRupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 2);
}

export function formatBudget(min: number | null, max: number | null, currency: string, model: string): string {
  const fmt = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v / 100);
  const suffix = model === 'hourly' ? ' per hour' : '';
  if (min !== null && max !== null && min !== max) return `${fmt(min)} – ${fmt(max)}${suffix}`;
  if (max !== null) return `Up to ${fmt(max)}${suffix}`;
  if (min !== null) return `From ${fmt(min)}${suffix}`;
  return 'Budget not set';
}

export function linesToList(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  hiring: 'Hiring',
  paused: 'Paused',
  closed: 'Closed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Exact amount from minor units, keeping paise when present (₹12,500 or ₹12,500.50). */
export function formatMinor(value: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: value % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export const PROPOSAL_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  shortlisted: 'Shortlisted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  offered: 'Offer received',
  hired: 'Hired',
};

export const CONTRACT_LABELS: Record<string, string> = {
  offered: 'Offer open',
  active: 'Active',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
