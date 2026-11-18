/**
 * Analytics helpers (Master Plan 4.4, PRODUCT_EXPERIENCE_SPEC §13), pure and
 * unit-tested. Every metric has a written definition so numbers cannot drift;
 * rates carry their sample size and a small-sample flag; money is always kept
 * per mode (sandbox test money is never added to live money).
 */

export const SMALL_SAMPLE = 5;

export interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
  small_sample: boolean;
}

/** A ratio with its sample. `value` is null when there is nothing to divide by. */
export function rate(numerator: number, denominator: number): Rate {
  return {
    value: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null,
    numerator,
    denominator,
    small_sample: denominator < SMALL_SAMPLE
  };
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 100) / 100;
}

/** The last `count` months as YYYY-MM keys, oldest first. */
export function monthKeys(today: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

export function monthStart(today: Date, monthsBack: number): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsBack, 1));
}

/** Monday-start ISO week keys (YYYY-MM-DD of the Monday), oldest first. */
export function weekKeys(today: Date, count: number): string[] {
  const day = today.getUTCDay();
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((day + 6) % 7)));
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(new Date(monday.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10));
  return keys;
}

/** Fills a series so every period appears, with zeros where there was no row. */
export function series<K extends string>(keys: string[], rows: Array<{ period: string } & Record<K, number>>, fields: K[]): Array<{ period: string } & Record<K, number>> {
  const byKey = new Map(rows.map((r) => [r.period, r]));
  return keys.map((period) => {
    const row = byKey.get(period);
    const values = Object.fromEntries(fields.map((f) => [f, row ? Number(row[f] ?? 0) : 0])) as Record<K, number>;
    return { period, ...values };
  });
}

export type BudgetBand = "within" | "below" | "above" | "no_budget";

export function budgetBand(price: number, min: number | null, max: number | null): BudgetBand {
  if (min === null && max === null) return "no_budget";
  if (max !== null && price > max) return "above";
  if (min !== null && price < min) return "below";
  return "within";
}

/** Success rate per budget band: shows whether pricing above the stated budget costs wins. */
export function pricingPerformance(rows: Array<{ price_minor: number; budget_min_minor: number | null; budget_max_minor: number | null; status: string }>) {
  const bands: BudgetBand[] = ["below", "within", "above", "no_budget"];
  return bands.map((band) => {
    const inBand = rows.filter((r) => budgetBand(r.price_minor, r.budget_min_minor, r.budget_max_minor) === band);
    const decided = inBand.filter((r) => DECIDED.includes(r.status));
    const won = decided.filter((r) => WON.includes(r.status));
    return { band, proposals: inBand.length, success: rate(won.length, decided.length) };
  });
}

/** Proposal statuses that count as a decision by the client, and as a win. */
export const DECIDED = ["declined", "offered", "hired"];
export const WON = ["offered", "hired"];

export const FREELANCER_DEFINITIONS: Record<string, string> = {
  proposals_sent: "Native proposals you sent on this marketplace in the period (external applications are counted separately).",
  proposal_success_rate: "Proposals that led to an offer or a hire ÷ proposals the client decided on (declined, offered or hired). Open and withdrawn proposals are excluded.",
  shortlist_rate: "Proposals shortlisted at any point, offered or hired ÷ proposals sent.",
  earnings_released: "Milestone amounts released to you after client approval, minus your platform fee, per payment mode. Sandbox amounts are test money, not income.",
  average_contract_value: "Average agreed total of your active and completed contracts (latest agreed version).",
  repeat_client_rate: "Client organisations with two or more contracts with you ÷ client organisations you have contracted with.",
  revision_rate: "Deliveries the client sent back for revision ÷ deliveries reviewed.",
  pricing_performance: "Success rate of decided proposals by where your price sat against the client's stated budget.",
  pipeline_value: "Agreed totals of active contracts minus amounts already released: work agreed but not yet paid. Not guaranteed income.",
  external_pipeline: "Jobs from approved public sources by status. External applications are never counted as native proposals, hires or earnings."
};

export const CLIENT_DEFINITIONS: Record<string, string> = {
  projects: "Your organisation's project listings by current status.",
  proposals_per_project: "Proposals received ÷ projects that were published.",
  time_to_first_proposal_hours: "Median hours from publication to the first proposal, for projects that received one.",
  time_to_hire_days: "Median days from publication to the first contract becoming active.",
  hiring_conversion: "Published projects with at least one active or completed contract ÷ published projects.",
  spend: "Milestone amounts you funded (amount plus client fee), per month and payment mode. Sandbox is test money.",
  delivery_days: "Median days from a contract becoming active to completion.",
  revision_rate: "Deliveries you sent back for revision ÷ deliveries you reviewed.",
  repeat_hire_rate: "Freelancers with two or more contracts ÷ freelancers you contracted.",
  committed_not_released: "Agreed totals of active contracts minus amounts already released: the budget still committed."
};

export const PLATFORM_DEFINITIONS: Record<string, string> = {
  registrations: "New accounts per week.",
  active_freelancers_30d: "Distinct freelancers who sent a proposal or delivered work in the last 30 days.",
  active_clients_30d: "Distinct client organisations that created or updated a project, or had contract activity, in the last 30 days.",
  native_listings_published: "Native client projects ever published (published_at set).",
  external_opportunities_30d: "External jobs collected for users in the last 30 days. Shown separately; never counted as marketplace activity.",
  project_to_hire: "Published native projects with an active or completed contract ÷ published native projects.",
  collected_value: "Client payments funded (total including client fee) per payment mode. Sandbox is test money.",
  platform_revenue: "Client and freelancer fees on released milestones, per payment mode. Sandbox amounts are not revenue.",
  dispute_rate: "Disputes opened ÷ contracts that became active.",
  ai_cost_per_completed_contract: "Estimated AI cost in the last 30 days ÷ contracts completed in the last 30 days.",
  retention_30d: "Accounts created 30–60 days ago with marketplace activity (proposal, project, contract message or delivery) in the last 30 days ÷ accounts created 30–60 days ago.",
  completed_contracts: "North-star metric: contracts completed per month (all milestones approved)."
};

/** Groups money rows by mode so test and live money are never summed together. */
export function byMode(rows: Array<{ mode: string; total: number | string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.mode] = (out[r.mode] ?? 0) + Number(r.total);
  return out;
}
