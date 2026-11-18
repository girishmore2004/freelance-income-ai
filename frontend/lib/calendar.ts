/** Calendar helpers (pure, unit-tested): grouping events by day and moving the window. */

export type CalendarEvent = {
  date: string; type: string; title: string; detail: string; href: string; overdue: boolean; side: 'freelancer' | 'client' | null;
};

export const TYPE_LABELS: Record<string, string> = {
  milestone_due: 'Milestone due',
  saved_closes: 'Saved project closes',
  saved_deadline: 'Saved project deadline',
  listing_closes: 'Your project closes',
  listing_deadline: 'Your project deadline',
  follow_up: 'Follow-up',
  interview: 'Interview',
};

/** Days in order, each with its events. Overdue items are collected first under "Overdue". */
export function groupByDay(events: CalendarEvent[], today: string): Array<{ key: string; label: string; events: CalendarEvent[] }> {
  const overdue = events.filter((e) => e.overdue && e.date < today);
  const rest = events.filter((e) => !(e.overdue && e.date < today));
  const days = new Map<string, CalendarEvent[]>();
  for (const e of rest) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  const groups = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ key: date, label: dayLabel(date, today), events: list }));
  return overdue.length ? [{ key: 'overdue', label: 'Overdue', events: overdue }, ...groups] : groups;
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === shiftDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function shiftDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
