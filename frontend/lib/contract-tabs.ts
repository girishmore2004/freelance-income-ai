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

/**
 * The one thing to do next on a contract, shown above its tabs so nobody has
 * to hunt through them. Pure, unit-tested.
 */
export function nextStep(status: string, party: 'client' | 'freelancer', hourly: boolean, actions: string[], canManage = true): { text: string; tab: ContractTab } | null {
  if (status === 'offered') {
    if (actions.includes('accept')) return { text: party === 'freelancer' ? 'Review the offer and accept it, or propose changes.' : 'The freelancer proposed changes: review and accept them, or reply.', tab: 'agreement' };
    return { text: 'Waiting for the other side to accept the terms.', tab: 'agreement' };
  }
  if (status === 'active') {
    if (actions.includes('accept')) return { text: 'A change to the contract is waiting for your answer.', tab: 'agreement' };
    if (hourly) return party === 'freelancer'
      ? { text: 'Log your hours and submit the week when it is done.', tab: 'hours' }
      : { text: canManage ? 'Approve submitted weeks and pay them.' : 'Hours are approved by the account owner or admins.', tab: 'hours' };
    return party === 'freelancer'
      ? { text: 'Deliver the next milestone when it is ready.', tab: 'delivery' }
      : { text: canManage ? 'Fund the next milestone, then review deliveries.' : 'Deliveries are reviewed by the account owner or admins.', tab: canManage ? 'payments' : 'delivery' };
  }
  if (status === 'completed') return { text: 'Work is finished: leave a review.', tab: 'reviews' };
  return null;
}
