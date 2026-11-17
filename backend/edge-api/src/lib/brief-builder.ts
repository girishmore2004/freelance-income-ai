import type { Env } from "../types";
import type { Sql } from "./core-routes";
import { reserveAiCall, settleAiCall } from "./ai-governor";
import { describeBlock, fenceInstruction, fenceUntrusted, newFenceId, reviewGeneratedText } from "./ai-guard";
import type { Milestone } from "./listings";

/**
 * C1 Brief Builder (Master Plan 3.7 / 3.9). Autonomy A2: it drafts, the client
 * confirms every field, it never publishes and never stores anything itself.
 *
 * Guardrails enforced in code (not only in the prompt):
 *  - the client's notes are fenced as untrusted text (ai-guard.ts);
 *  - the draft is reviewed: any price, link, email, guarantee or injection
 *    echo discards the AI draft (deterministic template is returned instead);
 *  - budget and deadline are never part of the output schema;
 *  - every field is length-capped; at most 5 questions are returned;
 *  - the AI governor's per-user quotas and global budget apply.
 */

export interface CategoryTemplate {
  inputs: string[];
  stages: string[];
  acceptance: string[];
  default_revisions: number;
}

export interface BriefDraft {
  title: string;
  outcome: string;
  deliverables: string[];
  skills: string[];
  milestones: Milestone[];
  acceptance_criteria: string[];
  assumptions: string[];
  questions: string[];
  conflicts: string[];
  revision_rounds: number;
}

export interface BriefAssistResult {
  draft: BriefDraft;
  source: "model" | "template";
  note?: string;
}

const MAX_NOTES = 6000;

function cap(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function capList(value: unknown, items: number, max: number): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map((v) => cap(v, max)).filter(Boolean))).slice(0, items) : [];
}

/** Deterministic draft from the category template (also the fallback). */
export function templateDraft(notes: string, categoryName: string, template: CategoryTemplate): BriefDraft {
  const clean = cap(notes, MAX_NOTES);
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? "";
  const lower = clean.toLowerCase();
  const missing = template.inputs.filter((input) => {
    const words = input.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    return !words.some((w) => lower.includes(w));
  });
  return {
    title: cap(firstSentence, 120) || `${categoryName} project`,
    outcome: cap(clean, 600),
    deliverables: [],
    skills: [],
    milestones: template.stages.slice(0, 8).map((stage) => ({ title: cap(stage, 120), description: "" })),
    acceptance_criteria: template.acceptance.slice(0, 10),
    assumptions: [],
    questions: missing.slice(0, 5).map((input) => `${input}: what do you need?`),
    conflicts: [],
    revision_rounds: template.default_revisions
  };
}

/** Extracts and normalises the model's JSON. Returns null when unusable. */
export function parseModelDraft(raw: string, fallback: BriefDraft): BriefDraft | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const milestones = Array.isArray(data.milestones)
    ? data.milestones
        .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
        .map((m) => ({ title: cap(m.title, 120), description: cap(m.description, 400) }))
        .filter((m) => m.title)
        .slice(0, 8)
    : [];
  const draft: BriefDraft = {
    title: cap(data.title, 120) || fallback.title,
    outcome: cap(data.outcome, 800) || fallback.outcome,
    deliverables: capList(data.deliverables, 12, 200),
    skills: capList(data.skills, 10, 50),
    milestones: milestones.length ? milestones : fallback.milestones,
    acceptance_criteria: capList(data.acceptance_criteria, 10, 250),
    assumptions: capList(data.assumptions, 8, 250),
    questions: capList(data.questions, 5, 250),
    conflicts: capList(data.conflicts, 5, 250),
    revision_rounds: fallback.revision_rounds
  };
  if (!draft.acceptance_criteria.length) draft.acceptance_criteria = fallback.acceptance_criteria;
  return draft;
}

function draftText(draft: BriefDraft): string {
  return [
    draft.title, draft.outcome, ...draft.deliverables, ...draft.skills,
    ...draft.milestones.flatMap((m) => [m.title, m.description]),
    ...draft.acceptance_criteria, ...draft.assumptions, ...draft.questions, ...draft.conflicts
  ].join("\n");
}

export async function buildBrief(
  env: Env,
  sql: Sql,
  userId: string,
  input: { notes: string; categoryName: string; template: CategoryTemplate }
): Promise<BriefAssistResult> {
  const notes = cap(input.notes, MAX_NOTES);
  const fallback = templateDraft(notes, input.categoryName, input.template);
  if (!env.AI) return { draft: fallback, source: "template", note: "AI is not configured; this draft comes from the category template." };

  const fenceId = newFenceId();
  const system =
    "You turn a client's informal project description into a structured freelance project brief. " +
    fenceInstruction(fenceId) + " " +
    "Reply with ONE JSON object only, with these keys: title (string), outcome (string), deliverables (string[]), " +
    "skills (string[]), milestones ({title, description}[]), acceptance_criteria (string[]), assumptions (string[]), " +
    "questions (string[], at most 5 focused questions about missing information), conflicts (string[], unrealistic or conflicting requirements). " +
    "Never include any price, budget, rate, currency amount, date, deadline, duration, link, email address or guarantee: the client sets budget and dates. " +
    "Label anything you infer as an assumption. Keep each item short.";
  const prompt =
    `CATEGORY: ${input.categoryName}\n` +
    `CATEGORY STAGES: ${input.template.stages.join("; ")}\n` +
    `ACCEPTANCE GUIDANCE: ${input.template.acceptance.join("; ")}\n` +
    `INFORMATION THIS CATEGORY USUALLY NEEDS: ${input.template.inputs.join("; ")}\n` +
    "CLIENT NOTES:\n" +
    fenceUntrusted("client_notes", notes, fenceId, MAX_NOTES);

  const decision = await reserveAiCall(env, sql, {
    userId,
    operation: "brief_builder",
    inputChars: system.length + prompt.length,
    maxOutputTokens: 900
  });
  if (!decision.allowed) return { draft: fallback, source: "template", note: decision.message };

  try {
    const result = (await env.AI.run(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      max_tokens: 900
    })) as { response?: string } | null;
    const raw = result?.response ?? "";
    await settleAiCall(env, sql, decision.eventId, system.length + prompt.length, raw.length);

    const draft = parseModelDraft(raw, fallback);
    if (!draft) return { draft: fallback, source: "template", note: "The AI reply could not be used; this draft comes from the category template." };

    // Timelines are not allowed in briefs either: the client sets dates.
    const review = reviewGeneratedText(draftText(draft), { price: null, allowedLinks: [] });
    const timeline = review.issues.some((issue) => issue.code === "explicit_timeline");
    if (review.blocked || timeline) {
      console.warn(JSON.stringify({ event: "ai.output_blocked", operation: "brief_builder", codes: review.issues.map((i) => i.code) }));
      const note = review.blocked ? describeBlock(review) : "The AI draft proposed dates or durations, which only you can set. A template was used instead.";
      return { draft: fallback, source: "template", note };
    }
    return { draft, source: "model" };
  } catch (error) {
    console.error(JSON.stringify({ event: "brief_builder.ai_failed", error_message: error instanceof Error ? error.message : "unknown" }));
    return { draft: fallback, source: "template", note: "The AI is unavailable right now; this draft comes from the category template." };
  }
}
