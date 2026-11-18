import type { Env } from "../types";
import {
  database,
  draftProposal,
  jsonList,
  loadProfile,
  scoreProfile,
  sha256Hex, safeHttpUrl } from "./core-routes";
import type { Row, Sql } from "./core-routes";
import { scoreOpportunity } from "./scoring";
import { fetchJson, normalizeType, parseDate, stripHtml } from "./source-utils";
import type { NormalizedJob } from "./source-utils";
import { fromFreelancer, fromHackerNews, fromHimalayas, fromReddit, fromRemoteOk } from "./project-sources";
import { recordOpportunityEvent, recordProposalVersion, tableExists } from "./external-pipeline";

export { parseDate };
export type { NormalizedJob };

const PROJECT_SOURCES = [
  ["freelancer", fromFreelancer],
  ["hackernews", fromHackerNews],
  ["reddit", fromReddit]
] as const;
const JOB_BOARD_SOURCES = [
  ["remotive", (term: string) => fromRemotive(term)],
  ["jobicy", (term: string) => fromJobicy(term)],
  ["remoteok", fromRemoteOk],
  ["himalayas", fromHimalayas]
] as const;
const ALL_SOURCE_NAMES = [...PROJECT_SOURCES, ...JOB_BOARD_SOURCES].map(([name]) => name);

/** What staff see on the source management page (U10). */
export const SOURCE_CATALOGUE: Array<{ code: string; label: string; kind: "project" | "job_board"; access: string }> = [
  { code: "freelancer", label: "Freelancer.com", kind: "project", access: "Official API (FREELANCER_TOKEN optional)" },
  { code: "hackernews", label: "Hacker News \"Who is hiring\"", kind: "project", access: "Official Algolia API" },
  { code: "reddit", label: "Reddit r/forhire", kind: "project", access: "Public JSON feed" },
  { code: "remotive", label: "Remotive", kind: "job_board", access: "Public API" },
  { code: "jobicy", label: "Jobicy", kind: "job_board", access: "Public API" },
  { code: "remoteok", label: "RemoteOK", kind: "job_board", access: "Public API" },
  { code: "himalayas", label: "Himalayas", kind: "job_board", access: "Public API" }
];

/** Sources staff switched off; empty before migration 0071 or if the table cannot be read. */
export async function disabledSources(sql: Sql): Promise<Set<string>> {
  try {
    if (!(await tableExists(sql, "discovery_sources"))) return new Set();
    const rows = await sql<Array<{ code: string }>>`SELECT code FROM discovery_sources WHERE enabled = false`;
    return new Set(rows.map((r) => r.code));
  } catch {
    return new Set();
  }
}

/** One row per source per run so staff can see failures and volume. Never blocks discovery. */
async function recordSourceRuns(sql: Sql, userId: string, sources: Array<{ name: string; fetched: number; error?: string }>): Promise<void> {
  try {
    if (!(await tableExists(sql, "discovery_source_runs"))) return;
    for (const s of sources) {
      await sql`
        INSERT INTO discovery_source_runs (id, source, user_id, fetched, error, created_at)
        VALUES (${crypto.randomUUID()}, ${s.name}, ${userId}, ${Math.max(0, s.fetched)}, ${(s.error ?? "").slice(0, 300)}, now())
      `;
    }
    // Retention: 90 days is enough for trends; keeps the table small.
    await sql`DELETE FROM discovery_source_runs WHERE created_at < now() - interval '90 days'`;
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "discovery.source_runs_failed", error: error instanceof Error ? error.message : "unknown" }));
  }
}

/**
 * Discovery agent.
 *
 * Project sources (Freelancer.com, Hacker News, Reddit r/forhire) plus
 * optional job boards (Remotive, Jobicy, RemoteOK, Himalayas; turn them off
 * with INCLUDE_JOB_BOARDS="false"). Public APIs and feeds only. It never logs
 * in to a marketplace and never submits anything. Source URLs always point
 * back to the original listing.
 *
 * Request budget: one search per run, runs >= 5h apart (Remotive allows
 * about 4 requests a day, Jobicy at most hourly).
 */

export const MIN_HOURS_BETWEEN_RUNS = 5;
const MAX_NEW_PER_RUN = 25;
const MIN_SCORE = 45;
const FETCH_LIMIT = 40;

export interface DiscoveryResult {
  ran: boolean;
  reason?: string;
  searched_for?: string;
  next_allowed_at?: string;
  sources?: Array<{ name: string; fetched: number; error?: string }>;
  fetched?: number;
  new_matches?: number;
  skipped_duplicates?: number;
  skipped_location?: number;
  skipped_work_type?: number;
  skipped_low_match?: number;
}

// Common technology words used to detect what a listing actually asks for.
const TECH_VOCAB = new Set(
  (
    "python javascript typescript react next.js nextjs node.js nodejs nestjs express fastapi django flask " +
    "postgresql postgres mysql mongodb redis docker kubernetes aws gcp azure graphql sql prisma langchain " +
    "llm llms rag openai pytorch tensorflow pandas numpy scikit-learn java go golang rust php laravel ruby rails " +
    "swift kotlin flutter vue angular svelte tailwind html css git linux terraform kafka rabbitmq celery " +
    "ai ml nlp cuda spark airflow dbt snowflake bigquery supabase firebase stripe wordpress shopify " +
    "c# c++ dotnet .net scala elixir solidity web3 selenium playwright jest cypress figma"
  ).split(" ")
);

export async function fromRemotive(term: string): Promise<NormalizedJob[]> {
  const data = await fetchJson(
    `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=${FETCH_LIMIT}`
  );
  const jobs: any[] = Array.isArray(data?.jobs) ? data.jobs : [];

  return jobs.slice(0, FETCH_LIMIT).map((job) => ({
    source: "remotive" as const,
    external_id: String(job.id),
    title: String(job.title ?? "").trim(),
    company: String(job.company_name ?? "Unknown").trim() || "Unknown",
    description: stripHtml(job.description),
    url: String(job.url ?? ""),
    job_type: normalizeType(job.job_type),
    industry: String(job.category ?? ""),
    location: String(job.candidate_required_location ?? ""),
    published_at: parseDate(job.publication_date)
  }));
}

export async function fromJobicy(term: string): Promise<NormalizedJob[]> {
  if (term.length < 3) return [];

  const data = await fetchJson(
    `https://jobicy.com/api/v2/remote-jobs?count=${FETCH_LIMIT}&tag=${encodeURIComponent(term)}`
  );
  const jobs: any[] = Array.isArray(data?.jobs) ? data.jobs : [];

  return jobs.slice(0, FETCH_LIMIT).map((job) => ({
    source: "jobicy" as const,
    external_id: String(job.id),
    title: String(job.jobTitle ?? "").trim(),
    company: String(job.companyName ?? "Unknown").trim() || "Unknown",
    description: stripHtml(job.jobDescription || job.jobExcerpt),
    url: String(job.url ?? ""),
    job_type: normalizeType(job.jobType),
    industry: Array.isArray(job.jobIndustry) ? String(job.jobIndustry[0] ?? "") : String(job.jobIndustry ?? ""),
    location: String(job.jobGeo ?? ""),
    published_at: parseDate(job.pubDate)
  }));
}

export function locationOk(location: string): boolean {
  const value = location.trim().toLowerCase();
  if (!value) return true;
  return /(worldwide|anywhere|global|remote|india|apac|asia|international)/.test(value);
}

export function workTypeOk(job: NormalizedJob, preferred: string[]): boolean {
  const wants = new Set(preferred.map((t) => t.toLowerCase().replace(/[\s-]+/g, "_")));
  const type = job.job_type;

  if (type === "project" || type === "freelance" || type === "contract" || type === "part_time") return true;
  if (type === "full_time") return wants.has("full_time") || wants.has("fulltime");
  if (type === "internship") return wants.has("internship");

  // Type not given: accept only when the text itself says freelance/contract.
  return /(freelanc|contract|part[- ]time|consult|short[- ]term)/i.test(`${job.title} ${job.description}`);
}

export function detectTech(job: NormalizedJob): string[] {
  const found = (`${job.title} ${job.description}`.toLowerCase().match(/[a-z0-9+#.\-]{2,}/g) ?? []).map((t) =>
    t.replace(/^[.\-]+|[.\-]+$/g, "")
  );
  const unique: string[] = [];

  for (const tag of job.tags ?? []) {
    const t = tag.trim().toLowerCase();
    if (TECH_VOCAB.has(t) && !unique.includes(t)) unique.push(t);
  }

  for (const token of found) {
    if (TECH_VOCAB.has(token) && !unique.includes(token)) unique.push(token);
    if (unique.length >= 12) break;
  }
  return unique;
}

function searchTerms(profile: Row): string[] {
  return [
    ...new Set(
      jsonList(profile.skills)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 3 && s.length <= 50)
    )
  ].slice(0, 6);
}

async function fingerprint(job: NormalizedJob): Promise<string> {
  return sha256Hex(`${job.title.toLowerCase()}|${job.company.toLowerCase()}`);
}

export async function runDiscovery(
  env: Env,
  sql: Sql,
  userId: string,
  options: { force?: boolean } = {}
): Promise<DiscoveryResult> {
  const profile = await loadProfile(sql, userId);
  const terms = searchTerms(profile);

  if (terms.length === 0) {
    return {
      ran: false,
      reason: "Add your skills in Profile first. The AI searches using your skills."
    };
  }

  const last = await sql`
    SELECT created_at FROM agent_runs
    WHERE user_id = ${userId} AND agent_name = 'discovery_agent'
    ORDER BY created_at DESC LIMIT 1
  `;

  if (last[0] && !options.force) {
    const nextAllowed = new Date(new Date(last[0].created_at).getTime() + MIN_HOURS_BETWEEN_RUNS * 3_600_000);
    if (nextAllowed.getTime() > Date.now()) {
      return {
        ran: false,
        reason:
          "Already searched recently. Job sites ask for a low request rate, so the next search opens soon. Your saved matches are below.",
        next_allowed_at: nextAllowed.toISOString()
      };
    }
  }

  const [{ count }] = await sql`
    SELECT count(*) AS count FROM agent_runs
    WHERE user_id = ${userId} AND agent_name = 'discovery_agent'
  `;
  const term = terms[Number(count) % terms.length];

  const sources: Array<{ name: string; fetched: number; error?: string }> = [];
  let jobs: NormalizedJob[] = [];

  const off = await disabledSources(sql);
  const wanted = [
    ...PROJECT_SOURCES.map(([name, fn]) => [name, (t: string) => fn(t, env)] as const),
    ...(env.INCLUDE_JOB_BOARDS === "false" ? [] : JOB_BOARD_SOURCES)
  ].filter(([name]) => !off.has(name));

  const settled = await Promise.allSettled(wanted.map(([, fn]) => fn(term)));
  settled.forEach((outcome, index) => {
    const name = wanted[index][0];
    if (outcome.status === "fulfilled") {
      sources.push({ name, fetched: outcome.value.length });
      jobs = jobs.concat(outcome.value);
    } else {
      sources.push({
        name,
        fetched: 0,
        error: outcome.reason instanceof Error ? outcome.reason.message : "request failed"
      });
    }
  });

  await recordSourceRuns(sql, userId, sources);

  const known = await sql`
    SELECT source, external_id, source_fingerprint FROM opportunities
    WHERE user_id = ${userId} AND source IN ${sql(ALL_SOURCE_NAMES as unknown as string[])}
    LIMIT 20000
  `;
  const knownIds = new Set(known.map((r) => `${r.source}:${r.external_id}`));
  const knownPrints = new Set(known.map((r) => r.source_fingerprint).filter(Boolean));

  const preferred = jsonList(profile.preferred_work_types);
  const result: DiscoveryResult = {
    ran: true,
    searched_for: term,
    sources,
    fetched: jobs.length,
    new_matches: 0,
    skipped_duplicates: 0,
    skipped_location: 0,
    skipped_work_type: 0,
    skipped_low_match: 0
  };

  const profileForScore = scoreProfile(profile);

  for (const job of jobs) {
    if ((result.new_matches ?? 0) >= MAX_NEW_PER_RUN) break;
    if (!job.title || !job.url || !job.external_id) continue;

    const print = await fingerprint(job);
    if (knownIds.has(`${job.source}:${job.external_id}`) || knownPrints.has(print)) {
      result.skipped_duplicates = (result.skipped_duplicates ?? 0) + 1;
      continue;
    }
    if (!locationOk(job.location)) {
      result.skipped_location = (result.skipped_location ?? 0) + 1;
      continue;
    }
    if (!workTypeOk(job, preferred)) {
      result.skipped_work_type = (result.skipped_work_type ?? 0) + 1;
      continue;
    }

    const required = detectTech(job);
    const { score, breakdown } = scoreOpportunity(profileForScore, {
      title: job.title,
      description: job.description,
      required_skills: required,
      budget_min: job.budget_min ?? null,
      budget_max: job.budget_max ?? null,
      deadline: "",
      job_type: job.job_type || "unknown",
      industry: job.industry,
      estimated_hours: null,
      competition_level: job.competition ?? "unknown",
      client_rating: null,
      client_reviews: null,
      client_payment_verified: null
    });

    const matched = (breakdown.notes.matched_skills as string[]) ?? [];
    if (matched.length === 0 || score < MIN_SCORE) {
      result.skipped_low_match = (result.skipped_low_match ?? 0) + 1;
      continue;
    }

    (breakdown.notes as Record<string, unknown>).job_location = job.location || "Not stated";
    (breakdown.notes as Record<string, unknown>).listed_job_type = job.job_type || "not stated";

    await sql`
      INSERT INTO opportunities (
        id, user_id, source, external_id, title, client_name, description, source_url,
        budget_min, budget_max, currency, required_skills, deadline, job_type, industry,
        estimated_hours, competition_level, client_rating, client_reviews,
        client_payment_verified, status, match_score, score_breakdown,
        source_fingerprint, first_seen_at, last_seen_at, published_at,
        duplicate_count, source_origins, created_at
      ) VALUES (
        ${crypto.randomUUID()}, ${userId}, ${job.source}, ${job.external_id}, ${job.title.slice(0, 300)},
        ${job.company.slice(0, 200)}, ${job.description}, ${safeHttpUrl(job.url)},
        ${job.budget_min ?? null}, ${job.budget_max ?? null}, ${job.currency || "USD"}, ${JSON.stringify(required)}, '', ${job.job_type || "unknown"},
        ${job.industry.slice(0, 100)}, NULL, ${job.competition ?? "unknown"}, NULL, NULL, NULL, 'new',
        ${score}, ${JSON.stringify(breakdown)}, ${print}, now(), now(), ${job.published_at},
        0, ${JSON.stringify([job.source])}, now()
      )
    `;

    knownIds.add(`${job.source}:${job.external_id}`);
    knownPrints.add(print);
    result.new_matches = (result.new_matches ?? 0) + 1;
  }

  const summary =
    `Searched "${term}": ` +
    sources.map((s) => `${s.name} ${s.error ? "failed (" + s.error + ")" : s.fetched}`).join(", ") +
    ` -> ${result.new_matches} new matches`;

  await sql`
    INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
    VALUES (${crypto.randomUUID()}, ${userId}, 'discovery_agent',
            ${sources.every((s) => s.error) ? "failed" : "completed"}, ${summary}, now())
  `;

  result.next_allowed_at = new Date(Date.now() + MIN_HOURS_BETWEEN_RUNS * 3_600_000).toISOString();
  return result;
}

/** Drafts proposals (never sends them) for the best new matches. */
export async function draftForTopMatches(
  env: Env,
  sql: Sql,
  userId: string,
  limit = 3
): Promise<number> {
  const profile = await loadProfile(sql, userId);

  const candidates = await sql`
    SELECT * FROM opportunities o
    WHERE o.user_id = ${userId} AND o.status = 'new' AND o.match_score >= 60
      AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.opportunity_id = o.id AND p.user_id = ${userId})
    ORDER BY o.match_score DESC, o.created_at DESC
    LIMIT ${limit}
  `;

  let drafted = 0;

  for (const opp of candidates) {
    const { content, mode } = await draftProposal(env, profile, opp, null, { sql, userId });

    const proposalId = crypto.randomUUID();
    await sql`
      INSERT INTO proposals (id, user_id, opportunity_id, version, content, proposed_price, currency, status, created_at)
      VALUES (${proposalId}, ${userId}, ${opp.id}, 1, ${content}, NULL, ${opp.currency || "USD"}, 'draft', now())
    `;
    await recordProposalVersion(sql, { proposalId, userId, version: 1, content, price: null, currency: String(opp.currency || "USD"), source: mode });
    await sql`UPDATE opportunities SET status = 'drafted' WHERE id = ${opp.id}`;
    await recordOpportunityEvent(sql, { opportunityId: String(opp.id), userId, kind: "status", from: String(opp.status || "new"), to: "drafted", note: "Drafted by the discovery agent for your review" });
    await sql`
      INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
      VALUES (${crypto.randomUUID()}, ${userId}, 'proposal_agent', 'completed',
              ${`Auto-drafted ${mode} proposal for "${String(opp.title).slice(0, 80)}"`}, now())
    `;
    drafted += 1;
  }

  return drafted;
}

/** Cron entry point: search and draft for every user with skills. */
export async function runScheduledDiscovery(env: Env): Promise<void> {
  const sql = database(env);

  try {
    const users = await sql`SELECT user_id FROM profiles WHERE skills <> '[]' LIMIT 10`;

    for (const row of users) {
      try {
        const result = await runDiscovery(env, sql, row.user_id);
        if (result.ran) await draftForTopMatches(env, sql, row.user_id, 3);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "discovery.scheduled_failed",
            error_message: error instanceof Error ? error.message : "unknown"
          })
        );
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
