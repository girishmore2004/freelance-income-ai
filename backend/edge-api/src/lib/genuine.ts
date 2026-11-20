import { screenText } from "./listings";
import type { NormalizedJob } from "./source-utils";

/**
 * Is an external listing genuine enough to show? (U30, 2026-11-20)
 *
 * Rules only, no AI: every listing collected from an outside source is checked before a
 * freelancer sees it. A listing is dropped when it shows a known scam pattern; nothing is
 * guessed. The checks follow common job-scam warnings: fees before work, payment or chat
 * moved to messaging apps, crypto/"investment" work, pay too good to be true, vague
 * "earn from home" ads, links that hide where they go, and listings with no real content.
 */

export type GenuineReason =
  | "asks_for_money"
  | "chat_app_contact"
  | "off_platform_payment"
  | "prohibited_work"
  | "link_shortener"
  | "too_good_to_be_true"
  | "vague_get_rich"
  | "no_real_content"
  | "unsafe_link"
  | "link_not_from_source";

export interface GenuineVerdict {
  genuine: boolean;
  reasons: GenuineReason[];
}

/** Where each source's listings must point (the original listing or its apply link). */
export const SOURCE_HOSTS: Record<string, string[]> = {
  freelancer: ["freelancer.com"],
  hackernews: ["news.ycombinator.com"],
  reddit: ["reddit.com"],
  remotive: ["remotive.com"],
  jobicy: ["jobicy.com"],
  remoteok: ["remoteok.com", "remoteok.io"],
  // Himalayas requires its own applicationLink for every Apply action.
  himalayas: ["himalayas.app"],
};

const CHAT_APPS = /\b(whats\s?app|telegram|signal\s+(me|app)|wechat|wickr|viber|kik)\b/i;
const MONEY_FIRST = /\b(registration|joining|security|training|application|processing|starter|kit|onboarding)\s+(fee|deposit|charges?|payment)\b|\bpay\s+(a\s+)?(small\s+)?(fee|deposit)\b|\b(buy|purchase)\s+(the\s+)?(starter\s+)?(kit|software|equipment)\s+(first|before)\b/i;
const GET_RICH = /\b(earn|make)\s+(up\s+to\s+)?(\$|₹|usd|inr|rs\.?)?\s?\d[\d,]*\s*(\+|k)?\s*(per|a|\/)\s*(day|daily|hour|week)\b[^.]{0,60}\b(no\s+experience|from\s+home|easy|simple|part[- ]time)\b|\b(no\s+experience\s+(needed|required))\b[^.]{0,80}\b(earn|daily\s+pay|weekly\s+pay)\b|\b(liking|like|rating)\s+(videos|posts|products|hotels)\b|\bcopy[- ]paste\s+jobs?\b|\bdata\s+entry\b[^.]{0,40}\b(daily\s+payment|earn\s+\d)/i;
const CRYPTO_INVEST = /\b(investment\s+(opportunity|plan)|forex\s+(trading|signals)|crypto\s+(trading|investment|recovery)|double\s+your\s+money|guaranteed\s+(returns|income|profit))\b/i;

/** Best hourly rate a listing promises, in USD (approximate; INR converted at 83). */
function promisedHourlyUsd(text: string): number | null {
  const m = [...text.matchAll(/(\$|usd\s?|₹|inr\s?|rs\.?\s?)(\d[\d,]*)(?:\s?k)?\s*(?:\/|per|an?)\s*(hr|hour)\b/gi)];
  if (!m.length) return null;
  return Math.max(...m.map((x) => {
    const n = Number(x[2].replace(/,/g, ""));
    return /₹|inr|rs/i.test(x[1]) ? n / 83 : n;
  }));
}

function hostOk(url: string, hosts: string[] | undefined): "ok" | "unsafe" | "foreign" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unsafe";
  }
  if (parsed.protocol !== "https:") return "unsafe";
  if (!hosts || !hosts.length) return "ok";
  const host = parsed.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`)) ? "ok" : "foreign";
}

/** Pure; exported for tests. */
export function assessListing(job: Pick<NormalizedJob, "source" | "title" | "description" | "url" | "company">): GenuineVerdict {
  const reasons = new Set<GenuineReason>();
  const text = `${job.title}\n${job.description}`;

  const codes = new Set(screenText(text).map((f) => f.code));
  if (codes.has("upfront_fee")) reasons.add("asks_for_money");
  if (codes.has("off_platform_payment")) reasons.add("off_platform_payment");
  if (codes.has("prohibited_work")) reasons.add("prohibited_work");
  if (codes.has("link_shortener")) reasons.add("link_shortener");
  // Email addresses and phone numbers are normal in real job ads; chat apps as the contact route are not.
  if (CHAT_APPS.test(text)) reasons.add("chat_app_contact");
  if (MONEY_FIRST.test(text)) reasons.add("asks_for_money");
  if (CRYPTO_INVEST.test(text)) reasons.add("off_platform_payment");
  if (GET_RICH.test(text)) reasons.add("vague_get_rich");
  const hourly = promisedHourlyUsd(text);
  if (hourly !== null && hourly > 500) reasons.add("too_good_to_be_true");
  if (job.title.trim().length < 6 || job.description.replace(/\s+/g, " ").trim().length < 80) reasons.add("no_real_content");
  const link = hostOk(job.url, SOURCE_HOSTS[job.source]);
  if (link === "unsafe") reasons.add("unsafe_link");
  if (link === "foreign") reasons.add("link_not_from_source");

  return { genuine: reasons.size === 0, reasons: [...reasons] };
}
