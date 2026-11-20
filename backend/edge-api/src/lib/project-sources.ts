import type { Env } from "../types";
import { fetchJson, normalizeType, parseDate, stripHtml } from "./source-utils";
import type { NormalizedJob } from "./source-utils";

/**
 * Real-project sources. Every source here is an official API, a public feed
 * or a public community thread that allows reading. None of them need a
 * login and nothing is ever submitted. Upwork, Fiverr, LinkedIn, Guru and
 * PeoplePerHour are NOT here because their terms forbid scraping.
 *
 * Each source fails on its own: one broken source never stops the others.
 */

const LIMIT = 40;

/** Pulls rough dollar amounts out of free text. Hourly rates are ignored. */
export function parseBudget(text: string): { min: number | null; max: number | null } {
  const amounts: number[] = [];
  const pattern = /(?:\$|usd\s?|inr\s?|₹|€|£)\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k)?(\s?(?:\/|per\s)?\s?(?:hr|hour|hourly))?/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[3]) continue;
    let value = Number(match[1].replace(/,/g, ""));
    if (match[2]) value *= 1000;
    if (value >= 20 && value <= 1_000_000) amounts.push(value);
  }

  if (amounts.length === 0) return { min: null, max: null };
  return { min: Math.min(...amounts), max: Math.max(...amounts) };
}

function firstLine(text: string, max = 120): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

function competition(bids: unknown): "low" | "medium" | "high" | "unknown" {
  const n = Number(bids);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 10) return "low";
  if (n < 30) return "medium";
  return "high";
}

/* ---------- Freelancer.com (official API: projects) ---------- */
export async function fromFreelancer(term: string, env?: Env): Promise<NormalizedJob[]> {
  const token = env?.FREELANCER_TOKEN;
  const data = await fetchJson(
    `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(term)}` +
      `&limit=${LIMIT}&full_description=true&job_details=true`,
    token ? { "freelancer-oauth-v1": token } : {},
    3600
  );
  const projects: any[] = Array.isArray(data?.result?.projects) ? data.result.projects : [];

  return projects.slice(0, LIMIT).map((p) => ({
    source: "freelancer",
    external_id: String(p.id),
    title: String(p.title ?? "").trim(),
    company: "Freelancer.com client",
    description: stripHtml(p.description || p.preview_description),
    url: p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : "",
    job_type: "project",
    industry: "",
    location: "",
    published_at: p.time_submitted ? new Date(Number(p.time_submitted) * 1000) : null,
    budget_min: p.budget?.minimum != null ? Number(p.budget.minimum) : null,
    budget_max: p.budget?.maximum != null ? Number(p.budget.maximum) : null,
    currency: String(p.currency?.code ?? "USD"),
    tags: Array.isArray(p.jobs) ? p.jobs.map((j: any) => String(j.name ?? "").toLowerCase()).filter(Boolean) : [],
    competition: competition(p.bid_stats?.bid_count)
  }));
}

/* ---------- Hacker News "Freelancer? Seeking freelancer?" (Algolia API) ---------- */
export async function fromHackerNews(_term: string): Promise<NormalizedJob[]> {
  const [freelance, hiring] = await Promise.allSettled([hnFreelancerThread(), hnWhoIsHiringContracts()]);
  const out = [
    ...(freelance.status === "fulfilled" ? freelance.value : []),
    ...(hiring.status === "fulfilled" ? hiring.value : []),
  ];
  if (!out.length && freelance.status === "rejected" && hiring.status === "rejected") throw freelance.reason;
  return out;
}

/** HN "Who is hiring?": company posts that offer contract, freelance or part-time remote work (U30). Pure filter; exported for tests. */
export function hiringPostToJob(c: { objectID: string; author?: string; comment_text?: string; created_at?: string }): NormalizedJob | null {
  const text = stripHtml(c.comment_text ?? "");
  const head = text.split("\n")[0] ?? "";
  // Companies post "Company | Role | Location | REMOTE | CONTRACT …" on the first line.
  if (!head.includes("|")) return null;
  if (!/\b(contract|contractor|freelance|freelancer|part[- ]time|consult(ant|ing))\b/i.test(head)) return null;
  if (!/\bremote\b/i.test(head)) return null;
  const parts = head.split("|").map((p) => p.trim()).filter(Boolean);
  const budget = parseBudget(text);
  return {
    source: "hackernews",
    external_id: String(c.objectID),
    title: firstLine(parts.slice(0, 2).join(" — ")),
    company: parts[0] || String(c.author ?? "Hacker News poster"),
    description: text,
    url: `https://news.ycombinator.com/item?id=${c.objectID}`,
    job_type: "contract",
    industry: "",
    location: "Remote",
    published_at: parseDate(c.created_at),
    budget_min: budget.min,
    budget_max: budget.max,
    currency: "USD",
    competition: "medium"
  };
}

async function hnWhoIsHiringContracts(): Promise<NormalizedJob[]> {
  const threads = await fetchJson(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=6",
    {},
    21600
  );
  const thread = (threads?.hits ?? []).find((h: any) => /who is hiring/i.test(String(h.title ?? "")));
  if (!thread?.objectID) return [];
  const comments = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${thread.objectID}&hitsPerPage=500`, {}, 21600);
  const out: NormalizedJob[] = [];
  for (const c of comments?.hits ?? []) {
    if (String(c.parent_id) !== String(thread.objectID)) continue; // top-level company posts only
    const job = hiringPostToJob(c);
    if (job) out.push(job);
  }
  return out;
}

async function hnFreelancerThread(): Promise<NormalizedJob[]> {
  const threads = await fetchJson(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Freelancer&hitsPerPage=6",
    {},
    21600
  );
  const thread = (threads?.hits ?? []).find((h: any) => /seeking freelancer/i.test(String(h.title ?? "")));
  if (!thread?.objectID) return [];

  const comments = await fetchJson(
    `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${thread.objectID}&hitsPerPage=100`,
    {},
    21600
  );

  const out: NormalizedJob[] = [];
  for (const c of comments?.hits ?? []) {
    if (String(c.parent_id) !== String(thread.objectID)) continue; // top-level posts only
    const text = stripHtml(c.comment_text);
    if (!/^\s*seeking freelancer/i.test(text)) continue; // clients only, not freelancers

    const budget = parseBudget(text);
    out.push({
      source: "hackernews",
      external_id: String(c.objectID),
      title: firstLine(text),
      company: String(c.author ?? "Hacker News poster"),
      description: text,
      url: `https://news.ycombinator.com/item?id=${c.objectID}`,
      job_type: "project",
      industry: "",
      location: /remote/i.test(text) ? "Remote" : "",
      published_at: parseDate(c.created_at),
      budget_min: budget.min,
      budget_max: budget.max,
      currency: "USD",
      competition: "low"
    });
  }
  return out;
}

/* ---------- Reddit r/forhire (public JSON listing) ---------- */
export async function fromReddit(_term: string, env?: Env): Promise<NormalizedJob[]> {
  // Reddit's Public Content Policy (May 2024) requires a contract for commercial use of its data.
  // Off until the founder records such an agreement (REDDIT_DATA_AGREEMENT=true, U30).
  if (env?.REDDIT_DATA_AGREEMENT !== "true") return [];
  const data = await fetchJson("https://www.reddit.com/r/forhire/new.json?limit=50&raw_json=1", {}, 3600);
  const posts: any[] = (data?.data?.children ?? []).map((c: any) => c.data);

  return posts
    .filter((p) => /^\s*\[?hiring\]?/i.test(String(p.title ?? "")) || String(p.link_flair_text ?? "").toLowerCase() === "hiring")
    .map((p) => {
      const text = `${p.title}\n${p.selftext ?? ""}`;
      const budget = parseBudget(text);
      return {
        source: "reddit",
        external_id: String(p.id),
        title: String(p.title ?? "").replace(/^\s*\[?hiring\]?\s*[-:]?\s*/i, "").trim(),
        company: String(p.author ?? "Reddit poster"),
        description: stripHtml(String(p.selftext ?? "")),
        url: `https://www.reddit.com${p.permalink}`,
        job_type: "project",
        industry: "",
        location: /remote/i.test(text) ? "Remote" : "",
        published_at: p.created_utc ? new Date(Number(p.created_utc) * 1000) : null,
        budget_min: budget.min,
        budget_max: budget.max,
        currency: "USD",
        competition: "medium" as const
      };
    });
}

/* ---------- RemoteOK (public API, link back + credit required) ---------- */
export async function fromRemoteOk(_term: string): Promise<NormalizedJob[]> {
  const data = await fetchJson("https://remoteok.com/api", {}, 21600);
  const jobs: any[] = Array.isArray(data) ? data.filter((j) => j && j.id && j.position) : [];

  return jobs.slice(0, 100).map((j) => ({
    source: "remoteok",
    external_id: String(j.id),
    title: String(j.position).trim(),
    company: String(j.company ?? "Unknown"),
    description: stripHtml(j.description),
    url: String(j.url ?? ""),
    job_type: "",
    industry: "",
    location: String(j.location ?? ""),
    published_at: parseDate(j.date),
    budget_min: j.salary_min ? Number(j.salary_min) : null,
    budget_max: j.salary_max ? Number(j.salary_max) : null,
    currency: "USD",
    tags: Array.isArray(j.tags) ? j.tags.map((t: unknown) => String(t).toLowerCase()) : []
  }));
}

/* ---------- Himalayas (public jobs API) ---------- */
export async function fromHimalayas(_term: string): Promise<NormalizedJob[]> {
  // The feed refreshes daily; three pages of 20, shared through the cache for a day (U30).
  const pages = await Promise.allSettled([0, 20, 40].map((offset) => fetchJson(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`, {}, 86400)));
  const jobs: any[] = pages.flatMap((p) => (p.status === "fulfilled" && Array.isArray(p.value?.jobs) ? p.value.jobs : []));
  if (!jobs.length && pages.every((p) => p.status === "rejected")) throw (pages[0] as PromiseRejectedResult).reason;

  return jobs.map((j) => ({
    source: "himalayas",
    external_id: String(j.guid ?? j.applicationLink ?? j.title),
    title: String(j.title ?? "").trim(),
    company: String(j.companyName ?? "Unknown"),
    description: stripHtml(j.description || j.excerpt),
    url: String(j.applicationLink || j.guid || ""),
    job_type: normalizeType(j.employmentType).replace("contractor", "contract"),
    industry: Array.isArray(j.categories) ? String(j.categories[0] ?? "") : "",
    location: Array.isArray(j.locationRestrictions) && j.locationRestrictions.length ? j.locationRestrictions.join(", ") : "Worldwide",
    published_at: j.pubDate ? new Date(Number(j.pubDate) * 1000) : null,
    budget_min: j.minSalary ? Number(j.minSalary) : null,
    budget_max: j.maxSalary ? Number(j.maxSalary) : null,
    currency: String(j.currency ?? "USD")
  }));
}
