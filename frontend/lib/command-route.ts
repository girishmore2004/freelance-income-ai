/** Routing for the AI command bar in the workspace shell. */

/** Command words → page. Anything else goes to the business coach as a prefilled question. Pure; exported for tests. */
export function routeCommand(text: string): string {
  const t = text.trim().toLowerCase();
  if (!t) return '/agent';
  const rules: Array<[RegExp, string]> = [
    [/\b(earn\w*|payouts?|withdraw\w*|paid|income)\b/, '/earnings'],
    [/\b(post\w*|hire|hiring|briefs?)\b/, '/client/projects'],
    [/\b(contracts?|deliver\w*|milestones?|revisions?|disputes?)\b/, '/contracts'],
    [/\b(find|search|projects?|jobs?|work|opportunit\w*)\b/, '/projects'],
    [/\b(next|todo|to do|plan|attention|pending)\b/, '/agent'],
    [/\b(agents?)\b/, '/ai-agents'],
    [/\b(notifications?|inbox)\b/, '/notifications'],
    [/\b(teams?|invit\w*|account|roles?)\b/, '/account'],
    [/\b(password|mfa|security|sessions?)\b/, '/security'],
  ];
  const hit = rules.find(([re]) => re.test(t));
  if (hit && t.split(/\s+/).length <= 4) return hit[1];
  return `/coach?ask=${encodeURIComponent(text.trim().slice(0, 500))}`;
}
