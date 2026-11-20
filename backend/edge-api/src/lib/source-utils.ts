export const FETCH_TIMEOUT_MS = 8000;

export interface NormalizedJob {
  source: string;
  external_id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  job_type: string;
  industry: string;
  location: string;
  published_at: Date | null;
  budget_min?: number | null;
  budget_max?: number | null;
  currency?: string;
  tags?: string[];
  competition?: "low" | "medium" | "high" | "unknown";
}

export function stripHtml(html: string): string {
  return String(html ?? "")
    .slice(0, 12000)
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 6000);
}

export function normalizeType(value: unknown): string {
  const raw = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value);
  const date = new Date(/(z|[+-]\d\d:?\d\d)$/i.test(raw) ? raw : raw + "Z");
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Fetches JSON from a source. With `cacheSeconds`, the response is shared through Cloudflare's
 * cache, so a source is called once per period for everyone instead of once per user and run
 * (U30): this keeps within each source's published limits (Remotive at most 4 a day, Jobicy at
 * most hourly, Himalayas daily refresh). Outside Workers (tests) there is no cache.
 */
export async function fetchJson(url: string, extraHeaders: Record<string, string> = {}, cacheSeconds = 0): Promise<any> {
  const cache: Cache | undefined = cacheSeconds > 0 ? (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default : undefined;
  const key = cache ? new Request(url, { method: "GET" }) : null;
  if (cache && key) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return await hit.json();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "FreelanceIncomeAI/1.0 (personal project search; low request rate)",
        ...extraHeaders
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!cache || !key) return await response.json();
    const text = await response.text();
    const data = JSON.parse(text);
    {
      await cache
        .put(key, new Response(text, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${cacheSeconds}` } }))
        .catch(() => undefined);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
