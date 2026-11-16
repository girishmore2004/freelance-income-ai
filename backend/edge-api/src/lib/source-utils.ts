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

export async function fetchJson(url: string, extraHeaders: Record<string, string> = {}): Promise<any> {
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
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
