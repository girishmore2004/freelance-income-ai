/** Duration helpers for hourly contracts (U19). Pure. */

/** "2 h 50 min", "45 min", "0 min". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/**
 * Typed durations to minutes: "1:30", "1.5", "1.5h", "90m", "2h 15m", "45".
 * A bare number up to 24 means hours; above 24 it means minutes. Null when invalid
 * or outside 1 minute to 24 hours.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let minutes: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = s.match(/^(\d{1,2})\s?h(?:ours?|rs?)?\s?(\d{1,2})\s?m(?:in(?:utes?|s)?)?$/))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = s.match(/^(\d+(?:\.\d+)?)\s?h(?:ours?|rs?)?$/))) minutes = Math.round(Number(m[1]) * 60);
  else if ((m = s.match(/^(\d+)\s?m(?:in(?:utes?|s)?)?$/))) minutes = Number(m[1]);
  else if ((m = s.match(/^\d+(?:\.\d+)?$/))) {
    const n = Number(s);
    minutes = n <= 24 ? Math.round(n * 60) : Math.round(n);
  }
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return null;
  return minutes;
}
