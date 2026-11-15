// TypeScript port of backend/app/scoring.py (score_opportunity).
// Deterministic 0-100 score with a transparent point breakdown.

export interface ScoreProfile {
  skills: string[];
  minimum_budget: number;
  weekly_hours: number;
  dealbreakers: string[];
  preferred_work_types: string[];
  preferred_industries: string[];
}

export interface ScoreOpportunity {
  title: string;
  description: string;
  required_skills: string[];
  budget_min: number | null;
  budget_max: number | null;
  deadline: string;
  job_type: string;
  industry: string;
  estimated_hours: number | null;
  competition_level: string;
  client_rating: number | null;
  client_reviews: number | null;
  client_payment_verified: boolean | null;
}

function tokens(text: string): Set<string> {
  const found = (text ?? "").toLowerCase().match(/[a-zA-Z0-9+#.]{2,}/g);
  return new Set(found ?? []);
}

function lowerSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
  );
}

function deadlineDays(value: string): number | null {
  if (!value) return null;
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(target)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((target - today) / 86_400_000));
}

// Python's round() rounds half to even; JS Math.round rounds half up.
function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function scoreOpportunity(
  profile: ScoreProfile,
  opp: ScoreOpportunity
): { score: number; breakdown: { points: Record<string, number>; notes: Record<string, unknown> } } {
  const skills = lowerSet(profile.skills);
  let required = lowerSet(opp.required_skills);

  if (required.size === 0) {
    const fromText = tokens(opp.description);
    required = new Set([...fromText].filter((t) => skills.has(t)));
  }

  const matched = new Set([...skills].filter((s) => required.has(s)));
  const skillScore = required.size > 0 ? pyRound((35 * matched.size) / required.size) : 18;

  const minimum = Number(profile.minimum_budget || 0);
  const budget = opp.budget_max ?? opp.budget_min;
  let budgetScore: number;

  if (budget === null || budget === undefined) budgetScore = 10;
  else if (budget >= minimum) budgetScore = 20;
  else if (minimum > 0) budgetScore = Math.max(0, pyRound((20 * Number(budget)) / minimum));
  else budgetScore = 20;

  let clientScore: number;
  let clientNote: string;

  if (
    opp.client_rating === null &&
    opp.client_reviews === null &&
    opp.client_payment_verified === null
  ) {
    clientScore = 8;
    clientNote = "Neutral: no client verification data supplied";
  } else {
    clientScore = 5;
    if (opp.client_rating !== null) {
      clientScore += pyRound((6 * Math.max(0, Math.min(5, Number(opp.client_rating)))) / 5);
    }
    if (opp.client_reviews !== null) {
      clientScore += opp.client_reviews >= 5 ? 2 : opp.client_reviews > 0 ? 1 : 0;
    }
    if (opp.client_payment_verified === true) clientScore += 2;
    clientScore = Math.min(15, clientScore);
    clientNote = "Based only on supplied client fields; verify source independently";
  }

  const days = deadlineDays(opp.deadline);
  const hours = opp.estimated_hours;
  const weeklyHours = Math.max(1, Math.trunc(profile.weekly_hours || 1));
  let deadlineScore: number;

  if (days === null || hours === null) {
    deadlineScore = 5;
  } else {
    const capacity = (weeklyHours * Math.max(0, days)) / 7;
    if (hours <= capacity) deadlineScore = 10;
    else if (capacity <= 0) deadlineScore = 0;
    else deadlineScore = Math.max(0, pyRound((10 * capacity) / Math.max(Number(hours), 1)));
  }

  const competition = String(opp.competition_level || "unknown").toLowerCase();
  const competitionScore =
    ({ low: 10, medium: 7, high: 4, unknown: 5 } as Record<string, number>)[competition] ?? 5;

  const description = (opp.description ?? "").trim();
  const words = description ? description.split(/\s+/).length : 0;
  const lowered = description.toLowerCase();
  const hasDeliverables = ["deliverable", "acceptance", "milestone", "provide", "build", "develop", "create"].some(
    (word) => lowered.includes(word)
  );
  const scopeScore = Math.min(
    10,
    3 + Math.min(5, Math.floor(words / 35)) + (hasDeliverables ? 2 : 0)
  );

  const points: Record<string, number> = {
    skill_fit: skillScore,
    budget_fit: budgetScore,
    client_quality: clientScore,
    deadline_feasibility: deadlineScore,
    competition_level: competitionScore,
    scope_clarity: scopeScore
  };

  const dealbreakers = lowerSet(profile.dealbreakers);
  const listingText = `${opp.title ?? ""} ${opp.description ?? ""}`.toLowerCase();
  const dealbreakerMatches = [...dealbreakers].filter((term) => listingText.includes(term)).sort();

  const preferredTypes = lowerSet(profile.preferred_work_types);
  const preferredIndustries = lowerSet(profile.preferred_industries);
  const jobType = String(opp.job_type || "unknown").toLowerCase();
  const industry = String(opp.industry || "").toLowerCase();
  const warnings: string[] = [];

  if (preferredTypes.size > 0 && jobType !== "unknown" && jobType !== "" && !preferredTypes.has(jobType)) {
    warnings.push("Work type is outside your stated preferences");
  }
  if (preferredIndustries.size > 0 && industry && !preferredIndustries.has(industry)) {
    warnings.push("Industry is outside your stated preferences");
  }

  const belowMinimum = budget !== null && budget !== undefined && minimum > 0 && Number(budget) < minimum;

  const notes = {
    matched_skills: [...matched].sort(),
    missing_skills: [...required].filter((s) => !skills.has(s)).sort(),
    client_quality_note: clientNote,
    deadline_data_complete: days !== null && hours !== null,
    competition_data_source:
      competition !== "unknown" ? "provided opportunity metadata" : "unknown; neutral score used",
    budget_data_available: budget !== null && budget !== undefined,
    dealbreaker_matches: dealbreakerMatches,
    manual_review_required: dealbreakerMatches.length > 0 || warnings.length > 0 || belowMinimum,
    eligible_by_profile_rules: !(dealbreakerMatches.length > 0 || belowMinimum),
    eligibility_warnings: [...warnings, ...(belowMinimum ? ["Listed budget is below your minimum"] : [])]
  };

  const score = Math.min(100, Object.values(points).reduce((a, b) => a + b, 0));

  return { score, breakdown: { points, notes } };
}
