/** Sidebar highlighting for the workspace shell. */

/**
 * Whether a sidebar link is the current page. Links with a query (e.g. /projects?view=saved)
 * match their view; the plain link (/projects) stays lit only when no sibling link matches.
 * Pure; exported for tests.
 */
export function isActive(path: string, href: string, query = '', siblings: string[] = []): boolean {
  const [base, q] = href.split('?');
  const params = new URLSearchParams(query);
  if (q !== undefined) {
    if (path !== base) return false;
    const want = new URLSearchParams(q);
    return [...want.entries()].every(([k, v]) => params.get(k) === v);
  }
  if (href === '/') return path === '/';
  if (!(path === href || path.startsWith(`${href}/`))) return false;
  return !siblings.some((s) => s !== href && s.includes('?') && isActive(path, s, query));
}
