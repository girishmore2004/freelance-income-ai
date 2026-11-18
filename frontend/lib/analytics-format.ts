/** Formatting for analytics pages (pure, unit-tested). */

export type Rate = { value: number | null; numerator: number; denominator: number; small_sample: boolean };

/** "67% (2 of 3)"; "No data yet" when nothing was decided. */
export function formatRate(r: Rate | null | undefined): string {
  if (!r || r.value === null) return 'No data yet';
  return `${Math.round(r.value * 100)}% (${r.numerator} of ${r.denominator})`;
}

export function sampleNote(r: Rate | null | undefined): string {
  if (!r || r.value === null || !r.small_sample) return '';
  return `Small sample (${r.denominator}): treat as an early signal, not a trend.`;
}

const MODE: Record<string, string> = { sandbox: 'Test mode (not real money)', live: 'Live' };
export const modeLabel = (mode: string) => MODE[mode] ?? mode;

export function rupees(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(minor / 100);
}

/** "2026-11" → "Nov 26"; week keys "2026-11-16" → "16 Nov". */
export function periodLabel(period: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = period.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return period;
  const month = months[Number(m[2]) - 1] ?? m[2];
  return m[3] ? `${Number(m[3])} ${month}` : `${month} ${m[1].slice(2)}`;
}
