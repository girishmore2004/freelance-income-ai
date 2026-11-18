/**
 * Contract timeline (U11): one ordered list of what happened and what is due,
 * built from the workspace (milestones, activity) and the task list. Pure, unit-tested.
 */

export type TimelineMilestone = { index: number; title: string; due_date: string | null; state: string };
export type TimelineTask = { id: string; title: string; due_date: string | null; status: string; owner_party: string; milestone_index: number | null };
export type TimelineActivity = { type: string; created_at: string; details: Record<string, unknown> };
export type TimelineEntry = { key: string; date: string; kind: 'past' | 'due' | 'overdue' | 'done'; text: string };

const LABELS: Record<string, string> = {
  'offer.sent': 'Offer sent', 'terms.accepted': 'Terms accepted', 'contract.activated': 'Contract became active',
  'milestone.submitted': 'Work delivered', 'milestone.approved': 'Milestone approved', 'milestone.revision_requested': 'Revision requested',
  'contract.completed': 'Contract completed', 'change.accepted': 'Change order accepted', 'tasks.planned': 'Task plan added',
  'handover.added': 'Handover item added', 'handover.confirmed': 'Handover item confirmed',
};

export function buildTimeline(milestones: TimelineMilestone[], tasks: TimelineTask[], activity: TimelineActivity[], today: string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const a of activity) {
    const label = LABELS[a.type];
    if (!label) continue;
    const title = typeof a.details.title === 'string' && a.details.title ? `: ${a.details.title}` : '';
    out.push({ key: `a-${a.type}-${a.created_at}`, date: a.created_at.slice(0, 10), kind: 'past', text: `${label}${title}` });
  }
  for (const m of milestones) {
    if (!m.due_date) continue;
    const done = m.state === 'approved';
    out.push({ key: `m-${m.index}`, date: m.due_date, kind: done ? 'done' : m.due_date < today ? 'overdue' : 'due', text: `Milestone ${m.index + 1} due: ${m.title}` });
  }
  for (const t of tasks) {
    if (!t.due_date) continue;
    const done = t.status === 'done';
    out.push({ key: `t-${t.id}`, date: t.due_date, kind: done ? 'done' : t.due_date < today ? 'overdue' : 'due', text: `Task (${t.owner_party}): ${t.title}` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** Share of tasks done, per milestone and overall; null when there are no tasks. */
export function taskProgress(tasks: TimelineTask[]): { done: number; total: number } | null {
  if (!tasks.length) return null;
  return { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length };
}
