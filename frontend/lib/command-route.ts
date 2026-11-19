/** Routing for the AI command bar in the workspace shell. */

/**
 * Command words → page of the active workspace, so the command bar never jumps
 * to the other side: clients search freelancers and see their spend; staff stay
 * in Admin. Anything else goes to the freelancer's business coach as a prefilled
 * question; on the client side to the action plan, in Admin to the Admin home.
 * Pure; exported for tests.
 */
export function routeCommand(text: string, side: 'freelancer' | 'client' | 'admin' = 'freelancer'): string {
  const t = text.trim().toLowerCase();
  if (!t) return side === 'admin' ? '/admin' : '/agent';
  const client = side === 'client';
  const admin = side === 'admin';
  const rules: Array<[RegExp, string]> = [
    [/\b(earn\w*|payouts?|withdraw\w*|paid|income|spend\w*|spent)\b/, admin ? '/finance' : client ? '/earnings?view=client' : '/earnings'],
    [/\b(post\w*|hire|hiring|briefs?)\b/, '/client/projects'],
    [/\b(contracts?|deliver\w*|milestones?|revisions?|disputes?)\b/, '/contracts'],
    [/\b(find|search|projects?|jobs?|work|opportunit\w*|freelancers?)\b/, admin ? '/admin' : client ? '/freelancers' : '/projects'],
    [/\b(next|todo|to do|plan|attention|pending)\b/, '/agent'],
    [/\b(agents?)\b/, '/ai-agents'],
    [/\b(inbox|messages?|interviews?|chats?)\b/, '/inbox'],
    [/\b(notifications?)\b/, '/notifications'],
    [/\b(teams?|invit\w*|account|roles?)\b/, '/account'],
    [/\b(password|mfa|security|sessions?)\b/, '/security'],
  ];
  const hit = rules.find(([re]) => re.test(t));
  if (hit && t.split(/\s+/).length <= 4) return hit[1];
  if (side === 'admin') return '/admin';
  if (side === 'client') return '/agent';
  return `/coach?ask=${encodeURIComponent(text.trim().slice(0, 500))}`;
}
