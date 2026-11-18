/** Shapes and helpers for proposal discussions, interviews and the inbox (U9). */

export type Interview = {
  id: string; status: string; proposed_party: 'client' | 'freelancer'; mine: boolean; starts_at: string; duration_minutes: number;
  mode: string; meeting_link: string; agenda: string; outcome_note: string; responded_at: string | null;
};
export type DiscussionMessage = { id: string; from: 'client' | 'freelancer'; mine: boolean; body: string; created_at: string };
export type Discussion = {
  party: 'client' | 'freelancer'; can_message: boolean; can_schedule: boolean; proposal_status: string;
  messages: DiscussionMessage[]; interviews: Interview[]; note: string;
};
export type InboxThread = {
  kind: 'contract' | 'proposal' | 'external'; id: string; title: string; last_message: string; last_at: string; from_other_side: boolean; href: string;
  /** Which side the thread belongs to (5.85.0); absent from older API versions. */
  side?: 'freelancer' | 'client';
};

export const INTERVIEW_LABELS: Record<string, string> = {
  proposed: 'Waiting for answer', accepted: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled', completed: 'Held',
};

export const THREAD_KIND_LABELS: Record<InboxThread['kind'], string> = {
  contract: 'Contract', proposal: 'Proposal', external: 'External application',
};

export function isDiscussion(v: unknown): v is Discussion {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<Discussion>;
  return (d.party === 'client' || d.party === 'freelancer') && Array.isArray(d.messages) && Array.isArray(d.interviews);
}

export function inboxThreads(v: unknown): InboxThread[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is InboxThread =>
    Boolean(t) && typeof t === 'object' && typeof (t as InboxThread).id === 'string' && typeof (t as InboxThread).title === 'string'
    && ['contract', 'proposal', 'external'].includes((t as InboxThread).kind));
}

/** `<input type="datetime-local">` value (local time) to an ISO instant, or null. */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** How many threads end with a message from the other side. */
export function needsReplyCount(threads: InboxThread[]): number {
  return threads.filter((t) => t.from_other_side).length;
}
