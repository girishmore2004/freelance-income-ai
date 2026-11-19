/**
 * Completing the partly built agents (U24). Pure rules only: no AI call,
 * no database, no clock (dates come in as arguments). Every function here is
 * advisory; nothing in this file sends, accepts, publishes or moves money.
 *
 *   F1  freshnessDecision      when an external job is hidden as stale
 *   F3  profileReview          unsupported claims and portfolio feedback
 *   F7  capacityPlan           booked hours against available hours, deadlines per week
 *   F9  triageMessage          what a message asks for, with a reply starter to edit
 *   F11 rankEvidence           records most related to a question (lexical retrieval)
 *   C7  spendForecast          money still to come on a client's contracts, by month
 *   P1  riskFindings           patterns for staff review (never an automatic action)
 *   P7  balanceAlerts          supply and demand gaps per category
 *   P9  notificationGroup      which settings group a notification belongs to
 */

/* ------------------------------------------------------------------ */
/* F1 Opportunity Scout: freshness                                     */
/* ------------------------------------------------------------------ */

/** External jobs older than this, and not seen at the source for NOT_SEEN_DAYS, are hidden (reversible). */
export const STALE_AFTER_DAYS = 21;
export const NOT_SEEN_DAYS = 7;

/** Whether an open external job should be hidden as stale. Pure. */
export function freshnessDecision(job: { status: string; posted_at: Date | null; first_seen_at: Date | null; last_seen_at: Date | null }, now: Date): { stale: boolean; age_days: number | null } {
  const posted = job.posted_at ?? job.first_seen_at;
  if (!posted) return { stale: false, age_days: null };
  const age = Math.floor((now.getTime() - posted.getTime()) / 86_400_000);
  const seen = job.last_seen_at ?? job.first_seen_at ?? posted;
  const unseen = Math.floor((now.getTime() - seen.getTime()) / 86_400_000);
  return { stale: job.status === "new" && age > STALE_AFTER_DAYS && unseen >= NOT_SEEN_DAYS, age_days: age };
}

/* ------------------------------------------------------------------ */
/* F3 Profile and Portfolio Coach: profile review                      */
/* ------------------------------------------------------------------ */

export type ReviewItem = { severity: "warn" | "info"; field: string; message: string };
export type PortfolioProject = { title: string; description: string; skills: string[]; link: string; year: string };

const CLAIM_WORDS = /\b(expert|world[-\s]?class|best|top[-\s]?rated|#\s?1|number one|guarantee[ds]?|100\s?%|unmatched|leading)\b/i;
const YEARS_CLAIM = /\b(\d{1,2})\s*\+?\s*(years?|yrs?)\b/i;

const lower = (s: string) => s.toLowerCase();

/** Reviews a freelancer's profile and portfolio for claims without evidence and thin entries. Pure. */
export function profileReview(input: {
  headline: string;
  bio: string;
  skills: string[];
  portfolio_links: string[];
  projects: PortfolioProject[];
  completed_contracts: number;
  reviews: number;
  hourly_rate: number;
}): { score: number; items: ReviewItem[]; projects: Array<{ index: number; title: string; issues: string[] }>; skills_without_evidence: string[] } {
  const items: ReviewItem[] = [];
  const text = `${input.headline} ${input.bio}`;
  const evidence = input.projects.length + input.portfolio_links.length + input.completed_contracts;

  const claim = text.match(CLAIM_WORDS);
  if (claim && input.completed_contracts === 0 && input.reviews === 0) {
    items.push({ severity: "warn", field: "headline", message: `"${claim[0]}" is a strong claim with no completed contracts or reviews yet. Clients trust specific results more: say what you built and for whom.` });
  }
  const years = text.match(YEARS_CLAIM);
  if (years && input.projects.length === 0) {
    items.push({ severity: "info", field: "bio", message: `You mention ${years[1]} years of experience. Add projects from those years so clients can see it.` });
  }
  if (input.headline.trim().length < 20) items.push({ severity: "warn", field: "headline", message: "Write a headline of at least 20 characters that says what you do and for whom." });
  if (input.bio.trim().length < 80) items.push({ severity: "info", field: "bio", message: "A short bio (80 characters or more) with one concrete result helps clients decide." });
  if (!input.hourly_rate) items.push({ severity: "info", field: "hourly_rate", message: "Add an hourly rate so price advice and matching can use it." });
  if (evidence === 0) items.push({ severity: "warn", field: "projects", message: "Add at least one project or portfolio link: profiles with work samples get far more invitations." });

  // Skills that no project, link or the bio shows.
  const shown = lower([input.bio, ...input.projects.map((p) => `${p.title} ${p.description} ${p.skills.join(" ")}`)].join(" "));
  const skillsWithout = input.skills.filter((s) => s.trim() && !shown.includes(lower(s.trim())));
  if (input.projects.length && skillsWithout.length) {
    items.push({ severity: "info", field: "skills", message: `No project shows ${skillsWithout.slice(0, 4).join(", ")}${skillsWithout.length > 4 ? " and more" : ""}. Add a project that uses them, or remove skills you would not be hired for.` });
  }

  const projects = input.projects.map((p, index) => {
    const issues: string[] = [];
    if (!p.link) issues.push("Add a link to the live work or a case study.");
    if (p.description.trim().length < 60) issues.push("Describe the problem, what you did and the result (60 characters or more).");
    if (!p.skills.length) issues.push("List the skills used.");
    if (!/^\d{4}$/.test(p.year)) issues.push("Add the year.");
    if (CLAIM_WORDS.test(p.description) && !p.link) issues.push("A strong claim without a link to the work: add the link.");
    return { index, title: p.title, issues };
  }).filter((p) => p.issues.length > 0);
  if (projects.length) items.push({ severity: "info", field: "projects", message: `${projects.length} project${projects.length === 1 ? "" : "s"} could be stronger; see the notes on each.` });

  const warns = items.filter((i) => i.severity === "warn").length;
  const infos = items.filter((i) => i.severity === "info").length;
  const score = Math.max(0, Math.min(100, 100 - warns * 20 - infos * 8));
  return { score, items, projects, skills_without_evidence: skillsWithout };
}

/* ------------------------------------------------------------------ */
/* F7 Delivery Planner: capacity                                       */
/* ------------------------------------------------------------------ */

export type CapacityInput = {
  weekly_hours: number;
  hourly: Array<{ contract_id: string; title: string; weekly_limit_hours: number }>;
  due: Array<{ date: string; title: string; kind: "milestone" | "task"; contract_id: string }>;
};

const mondayOf = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

/** Booked hours against available hours, and deadlines per week for the next 4 weeks. Pure. */
export function capacityPlan(input: CapacityInput, today: string) {
  const available = Math.max(0, Math.round(input.weekly_hours || 0));
  const booked = input.hourly.reduce((n, h) => n + Math.max(0, h.weekly_limit_hours), 0);
  const free = available - booked;
  const start = mondayOf(today);
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    const ws = d.toISOString().slice(0, 10);
    const end = new Date(d.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const due = input.due.filter((x) => x.date >= ws && x.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    return { week_start: ws, deadlines: due.length, items: due };
  });
  const overdue = input.due.filter((x) => x.date < today);
  const warnings: string[] = [];
  if (!available) warnings.push("Set your weekly hours on your profile so clients and this planner know your capacity.");
  else if (free < 0) warnings.push(`Hourly contracts allow up to ${booked} hours a week, more than the ${available} you are available. Talk to a client about the limit, or raise your hours.`);
  else if (available && free <= Math.max(2, Math.round(available * 0.1))) warnings.push(`Nearly fully booked: ${booked} of ${available} hours a week are on hourly contracts.`);
  for (const w of weeks) if (w.deadlines >= 3) warnings.push(`${w.deadlines} deadlines in the week of ${w.week_start}: plan the order now or agree new dates.`);
  if (overdue.length) warnings.push(`${overdue.length} deadline${overdue.length === 1 ? " has" : "s have"} passed: deliver or agree a new date with the client.`);
  return {
    available_hours: available,
    booked_hours: booked,
    free_hours: free,
    status: !available ? "unknown" : free < 0 ? "over" : free <= Math.max(2, Math.round(available * 0.1)) ? "full" : "open",
    hourly: input.hourly,
    weeks,
    overdue,
    warnings,
    note: "Booked hours count the weekly limits of your active hourly contracts. Fixed-price work shows as deadlines, not hours."
  };
}

/** Availability points and reason for matching, using free hours instead of total hours (F7 feeds C2). Pure. */
export function availabilityFit(weeklyHours: number | null, bookedHours: number): { points: number; reason: string | null; free: number } {
  const total = weeklyHours ?? 0;
  const free = total - bookedHours;
  // The reason is shown to clients: say "fully booked" without revealing the freelancer's other contracts.
  if (total > 0 && free <= 0) return { points: 0, reason: "Fully booked at the moment", free };
  const points = free >= 20 ? 10 : free >= 10 ? 7 : 3;
  return { points, reason: free >= 20 ? `Available about ${free} hours a week` : null, free };
}

/* ------------------------------------------------------------------ */
/* F9 Inbox Agent: triage of marketplace messages                      */
/* ------------------------------------------------------------------ */

export type Triage = { kind: "question" | "change_request" | "scheduling" | "approval" | "payment" | "thanks" | "update"; label: string; reply: string };

const TRIAGE: Array<{ kind: Triage["kind"]; label: string; test: RegExp; reply: string }> = [
  { kind: "payment", label: "About payment", test: /\b(pay|paid|payment|invoice|fund(ed|ing)?|refund)\b/i, reply: "Thanks for checking. Payments go through the platform: here is where things stand on the contract: " },
  { kind: "scheduling", label: "Wants to meet", test: /\b(call|meeting|meet|interview|zoom|schedule|reschedule|available (on|at|tomorrow)|tomorrow at|what time)\b/i, reply: "Happy to talk. These times work for me: " },
  { kind: "change_request", label: "Asks for a change", test: /\b(please (change|update|add|remove|fix|revise)|can you (change|update|add|remove|fix)|instead of|revision|not what (we|i) (asked|expected))\b/i, reply: "Understood. To confirm the change: … I can have it ready by " },
  { kind: "approval", label: "Approval or go-ahead", test: /\b(approved?|looks good|go ahead|accept(ed)?|happy with|lgtm)\b/i, reply: "Thank you! Next I will " },
  { kind: "question", label: "Asks a question", test: /\?|^\s*(what|how|when|where|why|which|who|can|could|would|do|does|is|are)\b/i, reply: "Good question. " },
  { kind: "thanks", label: "Thanks", test: /\b(thanks|thank you|great work|appreciate)\b/i, reply: "You're welcome. " }
];

/** What the other side's last message asks for, with a reply starter for the person to finish and send. Pure. */
export function triageMessage(text: string): Triage {
  const t = text.trim();
  for (const r of TRIAGE) if (r.test.test(t)) return { kind: r.kind, label: r.label, reply: r.reply };
  return { kind: "update", label: "Update", reply: "Thanks for the update. " };
}

/* ------------------------------------------------------------------ */
/* F11 Business Coach: retrieval                                       */
/* ------------------------------------------------------------------ */

export type Evidence = { id: string; type: string; text: string };

const STOP = new Set(["the", "and", "for", "with", "that", "this", "what", "which", "have", "from", "your", "you", "are", "was", "how", "can", "should", "about", "into", "they", "them", "there", "when", "will", "would", "could", "does", "did", "not", "any", "all", "our", "who", "why", "where", "status"]);
const tokens = (s: string): string[] => lower(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** The records most related to the question (TF-IDF over the user's own records); the profile always stays. Pure. */
export function rankEvidence(question: string, evidence: Evidence[], limit = 25): Array<Evidence & { relevance: number }> {
  const q = [...new Set(tokens(question))];
  const docs = evidence.map((e) => tokens(`${e.type} ${e.text}`));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, evidence.length);
  const scored = evidence.map((e, i) => {
    const counts = new Map<string, number>();
    for (const w of docs[i]) counts.set(w, (counts.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      const tf = counts.get(w) ?? 0;
      if (tf) score += (1 + Math.log(tf)) * Math.log(1 + n / (df.get(w) ?? 1));
      // A word in the question naming the record type (e.g. "contract", "review") counts too.
      else if (e.type.startsWith(w.replace(/s$/, ""))) score += 0.5;
    }
    return { ...e, relevance: Math.round(score * 100) / 100, order: i };
  });
  const pinned = scored.filter((e) => e.type === "profile");
  const rest = scored.filter((e) => e.type !== "profile").sort((a, b) => b.relevance - a.relevance || a.order - b.order);
  return [...pinned, ...rest].slice(0, limit).map(({ order: _order, ...e }) => e);
}

/** A cited answer without the model: the most related records, plainly listed. Pure. */
export function ruleAnswer(question: string, ranked: Array<Evidence & { relevance: number }>): string {
  const related = ranked.filter((e) => e.relevance > 0 && e.type !== "profile").slice(0, 5);
  if (!related.length) {
    return "The AI model was not used, and none of your records match the words in your question. Ask about a contract, proposal, project, service, review or your earnings by name.";
  }
  const lines = related.map((e) => `- [${e.id}] ${e.text.slice(0, 160)}`);
  return `The AI model was not used, so this is a list, not advice. Your records most related to "${question.slice(0, 120)}":\n${lines.join("\n")}\nOpen them to decide the next step; nothing has been changed.`;
}

/* ------------------------------------------------------------------ */
/* C7 Spend and Outcomes: forecast                                     */
/* ------------------------------------------------------------------ */

export type ForecastMilestone = { contract_id: string; title: string; milestone: string; amount_minor: number; due_date: string | null; state: "unfunded" | "held" };
export type ForecastHourly = { contract_id: string; title: string; hourly_rate_minor: number; weekly_limit_hours: number };

/** Money still to come on active contracts, by month, with the client fee when one is approved. Pure. */
export function spendForecast(milestones: ForecastMilestone[], hourly: ForecastHourly[], clientFeeBps: number | null, today: string, months = 6) {
  const fee = (amount: number) => (clientFeeBps === null ? 0 : Math.round((amount * clientFeeBps) / 10_000));
  const start = today.slice(0, 7);
  const keys = Array.from({ length: months }, (_, i) => {
    const d = new Date(`${start}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 7);
  });
  const byMonth = new Map(keys.map((k) => [k, { month: k, amount_minor: 0, fee_minor: 0, milestones: 0 }]));
  let undated = { amount_minor: 0, fee_minor: 0, milestones: 0 };
  let overdue = { amount_minor: 0, fee_minor: 0, milestones: 0 };
  let later = { amount_minor: 0, fee_minor: 0, milestones: 0 };
  let held = 0;
  for (const m of milestones) {
    if (m.state === "held") { held += m.amount_minor; continue; }
    const add = (b: { amount_minor: number; fee_minor: number; milestones: number }) => { b.amount_minor += m.amount_minor; b.fee_minor += fee(m.amount_minor); b.milestones += 1; };
    if (!m.due_date) add(undated);
    else if (m.due_date < today && m.due_date.slice(0, 7) < start) add(overdue);
    else {
      const bucket = byMonth.get(m.due_date.slice(0, 7));
      if (bucket) add(bucket);
      else if (m.due_date.slice(0, 7) < start) add(overdue);
      else add(later);
    }
  }
  const weekly = hourly.reduce((n, h) => n + h.hourly_rate_minor * h.weekly_limit_hours, 0);
  const unfunded = milestones.filter((m) => m.state === "unfunded").reduce((n, m) => n + m.amount_minor, 0);
  return {
    months: [...byMonth.values()],
    overdue, undated, later,
    held_minor: held,
    remaining_fixed_minor: unfunded,
    remaining_fixed_fee_minor: fee(unfunded),
    hourly_weekly_max_minor: weekly,
    hourly_weekly_max_fee_minor: fee(weekly),
    hourly,
    fee_known: clientFeeBps !== null,
    note: clientFeeBps === null
      ? "No fee schedule is approved yet, so fees are not included."
      : "Amounts are the agreed milestone prices plus the client fee. Hourly contracts can cost up to their weekly limit each week until they end."
  };
}

/* ------------------------------------------------------------------ */
/* P1 Trust and Safety: patterns for staff                             */
/* ------------------------------------------------------------------ */

export type RiskFinding = { kind: string; severity: "high" | "medium"; summary: string; user_ids: string[]; organization_id: string | null; evidence: string[] };

/** Turns counted patterns into findings for staff to review. No automatic action is ever taken. Pure. */
export function riskFindings(input: {
  attempts: Array<{ user_id: string; contact: number; payment: number; last_at: string }>;
  circular: Array<{ user_a: string; user_b: string; contract_a: string; contract_b: string }>;
  ownTeam: Array<{ contract_id: string; freelancer_user_id: string; organization_id: string }>;
  oneAndDone: Array<{ freelancer_user_id: string; organization_id: string; contract_id: string; attempts: number }>;
  troubled: Array<{ user_id: string; cancelled: number; disputed: number }>;
}): RiskFinding[] {
  const out: RiskFinding[] = [];
  for (const a of input.attempts) {
    const total = a.contact + a.payment;
    if (total < 3) continue;
    out.push({
      kind: "repeated_off_platform", severity: total >= 5 || a.payment >= 2 ? "high" : "medium",
      summary: `Tried ${total} times in 30 days to share contact details (${a.contact}) or move payment off the platform (${a.payment}).`,
      user_ids: [a.user_id], organization_id: null, evidence: [`last attempt ${a.last_at.slice(0, 10)}`]
    });
  }
  for (const c of input.circular) {
    out.push({
      kind: "circular_hiring", severity: "high",
      summary: "Two accounts hire each other through each other's client accounts.",
      user_ids: [c.user_a, c.user_b], organization_id: null, evidence: [`contract ${c.contract_a}`, `contract ${c.contract_b}`]
    });
  }
  for (const o of input.ownTeam) {
    out.push({
      kind: "own_team_contract", severity: "medium",
      summary: "A contract between a client account and someone who is or was on its team.",
      user_ids: [o.freelancer_user_id], organization_id: o.organization_id, evidence: [`contract ${o.contract_id}`]
    });
  }
  for (const d of input.oneAndDone) {
    out.push({
      kind: "left_after_first_project", severity: "medium",
      summary: `One completed project, no further work on the platform, and ${d.attempts} blocked attempt${d.attempts === 1 ? "" : "s"} to share contact details between them.`,
      user_ids: [d.freelancer_user_id], organization_id: d.organization_id, evidence: [`contract ${d.contract_id}`]
    });
  }
  for (const t of input.troubled) {
    if (t.cancelled + t.disputed < 2) continue;
    out.push({
      kind: "many_cancellations", severity: t.disputed >= 2 ? "high" : "medium",
      summary: `${t.cancelled} cancelled and ${t.disputed} disputed contracts in 90 days.`,
      user_ids: [t.user_id], organization_id: null, evidence: []
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

/** The kind of trust signal a screening refusal records. Pure. */
export function signalKind(codes: string[]): "contact_attempt" | "payment_attempt" | null {
  if (codes.includes("off_platform_payment") || codes.includes("upfront_fee")) return "payment_attempt";
  if (codes.includes("off_platform_contact")) return "contact_attempt";
  return null;
}

/* ------------------------------------------------------------------ */
/* P7 Marketplace Balance: supply and demand alerts                    */
/* ------------------------------------------------------------------ */

export type CategoryBalance = { slug: string; name: string; enabled: boolean; open_projects: number; waiting_projects: number; proposals_30d: number; freelancers_90d: number; services_live: number };
export type BalanceAlert = { kind: "waiting_projects" | "no_supply" | "no_demand" | "crowded"; severity: "high" | "medium"; category: string; message: string };

/** Supply and demand gaps per category for staff. Pure. */
export function balanceAlerts(rows: CategoryBalance[], visibleFreelancers: number): BalanceAlert[] {
  const out: BalanceAlert[] = [];
  for (const r of rows) {
    if (r.waiting_projects > 0) {
      out.push({ kind: "waiting_projects", severity: r.waiting_projects >= 3 ? "high" : "medium", category: r.slug, message: `${r.waiting_projects} project${r.waiting_projects === 1 ? "" : "s"} in ${r.name} ${r.waiting_projects === 1 ? "has" : "have"} no proposal after 3 days. Invite freelancers or check the briefs.` });
    }
    if (r.open_projects > 0 && r.freelancers_90d === 0 && r.services_live === 0) {
      out.push({ kind: "no_supply", severity: "high", category: r.slug, message: `${r.name} has ${r.open_projects} open project${r.open_projects === 1 ? "" : "s"} but no freelancer has proposed in it for 90 days and no service is for sale.` });
    }
    if (r.enabled && r.open_projects === 0 && r.freelancers_90d >= 5) {
      out.push({ kind: "no_demand", severity: "medium", category: r.slug, message: `${r.freelancers_90d} freelancers work in ${r.name}, but it has no open project. Reach out to clients in this category.` });
    }
    if (r.open_projects > 0 && r.proposals_30d / r.open_projects >= 30) {
      out.push({ kind: "crowded", severity: "medium", category: r.slug, message: `${r.name} gets about ${Math.round(r.proposals_30d / r.open_projects)} proposals per open project: newcomers will struggle to be seen.` });
    }
  }
  if (visibleFreelancers === 0 && rows.some((r) => r.open_projects > 0)) {
    out.unshift({ kind: "no_supply", severity: "high", category: "all", message: "No freelancer is visible to clients yet, so matching finds nobody." });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* P9 Notification Orchestrator: settings groups                       */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_GROUPS = [
  { key: "proposals", label: "Proposals, invitations and offers", mutable: true },
  { key: "work", label: "Contract work: deliveries, messages, tasks, hours", mutable: true },
  { key: "payments", label: "Payments and payouts", mutable: true },
  { key: "alerts", label: "Job alerts and digests", mutable: true },
  { key: "team", label: "Team and client account", mutable: true },
  { key: "account", label: "Account, safety and disputes (always on)", mutable: false }
] as const;
export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number]["key"];

/** The settings group of a notification kind. Unknown kinds count as account notices (never muted). Pure. */
export function notificationGroup(kind: string): NotificationGroupKey {
  if (/^(proposal|invitation|interview|offer|terms|order)\./.test(kind)) return "proposals";
  if (/^(milestone\.(funded|released|refunded)|timesheet\.paid|payout)/.test(kind)) return "payments";
  if (/^(contract|milestone|tasks|handover|change|message|timesheet|cancellation|review)\./.test(kind)) return "work";
  if (/^(search|jobs|platform)\./.test(kind)) return "alerts";
  if (/^organization\./.test(kind)) return "team";
  return "account";
}
