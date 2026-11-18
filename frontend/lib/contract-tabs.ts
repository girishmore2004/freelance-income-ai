/**
 * Tabs of the contract workspace (PRODUCT_EXPERIENCE_SPEC §11) and which ones
 * apply to a contract in a given status. Pure, unit-tested.
 */

export type ContractTab = 'agreement' | 'delivery' | 'hours' | 'tasks' | 'timeline' | 'files' | 'messages' | 'payments' | 'disputes' | 'handover' | 'reviews' | 'activity';

export const CONTRACT_TABS: Array<{ key: ContractTab; label: string; statuses: string[] }> = [
  { key: 'agreement', label: 'Agreement', statuses: ['offered', 'active', 'completed', 'declined', 'withdrawn', 'cancelled'] },
  { key: 'delivery', label: 'Milestones and delivery', statuses: ['offered', 'active', 'completed'] },
  { key: 'hours', label: 'Hours', statuses: ['offered', 'active', 'completed'] },
  { key: 'tasks', label: 'Tasks', statuses: ['active', 'completed'] },
  { key: 'timeline', label: 'Timeline', statuses: ['active', 'completed'] },
  { key: 'files', label: 'Files', statuses: ['offered', 'active', 'completed'] },
  { key: 'messages', label: 'Messages', statuses: ['offered', 'active', 'completed'] },
  { key: 'payments', label: 'Payments', statuses: ['active', 'completed', 'cancelled'] },
  { key: 'disputes', label: 'Disputes', statuses: ['active', 'completed', 'cancelled'] },
  { key: 'handover', label: 'Handover', statuses: ['active', 'completed'] },
  { key: 'reviews', label: 'Reviews', statuses: ['completed'] },
  { key: 'activity', label: 'Activity', statuses: ['offered', 'active', 'completed'] },
];

/** Hourly contracts (U19) are paid per approved week: an Hours tab replaces milestones and delivery. */
export function tabsFor(status: string, hourly = false): Array<{ key: ContractTab; label: string }> {
  return CONTRACT_TABS
    .filter((t) => t.statuses.includes(status) && (hourly ? t.key !== 'delivery' : t.key !== 'hours'))
    .map(({ key, label }) => ({ key, label }));
}

/** Where a contract opens: the terms while offered, the work while active, reviews once completed. */
export function defaultTab(status: string, hourly = false): ContractTab {
  if (status === 'active') return hourly ? 'hours' : 'delivery';
  if (status === 'completed') return 'reviews';
  return 'agreement';
}
