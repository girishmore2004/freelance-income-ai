/**
 * Link targets from job feeds or users must be absolute http(s) URLs. Anything
 * else (javascript:, data:, relative paths) becomes '#'. React 18 renders a
 * javascript: href as-is, so every external link goes through here.
 */
export function safeHref(value: unknown): string {
  if (typeof value !== 'string') return '#';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '#';
  } catch {
    return '#';
  }
}
