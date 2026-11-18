/** Labels for the external application lifecycle (mirrors the Edge state machine). */

export const EXTERNAL_STATUS_LABELS: Record<string, string> = {
  new: 'New', drafted: 'Draft ready', ready: 'Approved', applied: 'Applied', replied: 'Client replied', interview: 'Interview',
  offer: 'Offer', won: 'Won', lost: 'Lost', withdrawn: 'Withdrawn', skipped: 'Skipped',
};

const ACTION: Record<string, string> = {
  applied: 'I applied — record submission', replied: 'Client replied', interview: 'Interview scheduled', offer: 'Offer received',
  won: 'I won this job', lost: 'Lost', withdrawn: 'I withdrew', skipped: 'Not interested', new: 'Reopen',
};

export function transitionLabel(status: string): string {
  return ACTION[status] ?? status;
}
