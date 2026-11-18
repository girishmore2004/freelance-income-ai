import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, jsonList, loadProfile, safeHttpUrl } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { fenceInstruction, fenceUntrusted, newFenceId, redactContactDetails } from "./ai-guard";
import { reserveAiCall, settleAiCall } from "./ai-governor";
import { screenText } from "./listings";
import { evaluateCandidate, normaliseSkill } from "./matching";
import type { CandidateRow, ListingForMatch } from "./matching";

/**
 * Freelancer profile tools (U17): resume import, own project list, and
 * "projects for you".
 *
 *   POST /api/v1/profile/resume-extract     multipart `file` (PDF, DOCX, TXT, MD; ≤ 5 MB) or JSON {text}
 *        → suggestions only (headline, summary, skills, services, projects, links). NOTHING is saved and
 *          the file is not stored: the person ticks what to keep and saves the profile themselves.
 *   GET  /api/v1/me/portfolio-projects       PUT {items[]} (≤ 20): title, description, skills, link, year
 *   GET  /api/v1/me/suggested-projects       native projects scored with the client-side matching rules,
 *                                            plus the strongest external opportunities already scored for you
 *
 * Agent F3 (Profile and Portfolio Coach) reads the resume through the AI governor. Its output is
 * checked against the resume text: a skill, project title or link that does not appear in the
 * resume is dropped and listed, and contact details are removed. Without the model a rules-only
 * reader finds skills and links. Legal names, emails and phone numbers are never extracted.
 */

export interface ProfileRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: ProfileRouteDeps = { database, authenticate: authenticateRequest };

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_RESUME_CHARS = 30_000;
export const MAX_PROJECTS = 20;

/* ------------------------------------------------------------------ */
/* Text extraction                                                     */
/* ------------------------------------------------------------------ */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads one file out of a ZIP (stored or deflated) via the central directory. Pure apart from decompression. */
export async function readZipEntry(zip: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i -= 1) {
    if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  for (let n = 0; n < count && p + 46 <= zip.length; n += 1) {
    if (u32(zip, p) !== 0x02014b50) return null;
    const method = u16(zip, p + 10);
    const size = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const local = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const dataStart = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
      const raw = zip.subarray(dataStart, dataStart + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Plain text of a Word document's main body (paragraphs become lines). */
export async function docxText(bytes: Uint8Array): Promise<string | null> {
  const xmlBytes = await readZipEntry(bytes, "word/document.xml");
  if (!xmlBytes) return null;
  const xml = new TextDecoder().decode(xmlBytes);
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ToMarkdown = (files: Array<{ name: string; blob: Blob }>) => Promise<Array<{ data?: string; format?: string }>>;

/* ------------------------------------------------------------------ */
/* Rules-only reading                                                  */
/* ------------------------------------------------------------------ */

const SKILLS: string[] = [
  "Python", "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "NestJS", "Express", "FastAPI", "Django", "Flask",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes", "AWS", "GCP", "Azure", "GraphQL", "SQL", "Prisma",
  "LangChain", "LLM", "RAG", "OpenAI", "PyTorch", "TensorFlow", "Pandas", "NumPy", "scikit-learn", "Java", "Go", "Rust",
  "PHP", "Laravel", "Ruby on Rails", "Swift", "Kotlin", "Flutter", "React Native", "Android", "iOS", "Vue", "Angular", "Svelte",
  "Tailwind CSS", "HTML", "CSS", "Git", "Linux", "Terraform", "Kafka", "Firebase", "Supabase", "Stripe", "WordPress",
  "Shopify", "Webflow", "Wix", "C#", "C++", ".NET", "Solidity", "Selenium", "Playwright", "Jest", "Cypress", "Figma",
  "UI design", "UX design", "Graphic design", "Logo design", "Illustration", "Photoshop", "Illustrator", "Canva",
  "Video editing", "Premiere Pro", "After Effects", "SEO", "Content writing", "Copywriting", "Technical writing",
  "Digital marketing", "Social media marketing", "Google Ads", "Email marketing", "Excel", "Power BI", "Tableau",
  "Data analysis", "Data entry", "Machine learning", "Deep learning", "Computer vision", "NLP", "Translation",
  "Bookkeeping", "Accounting", "Project management", "Customer support", "Virtual assistance", "REST APIs", "Microservices"
];

/** Contact details only: profile text may legitimately mention crypto or payments as skills. */
const hasContact = (s: string) => screenText(s).some((f) => f.code === "off_platform_contact");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Skills from the fixed vocabulary that the text names. Pure. */
export function skillsInText(text: string): string[] {
  const found: string[] = [];
  for (const skill of SKILLS) {
    const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(skill.toLowerCase())}(?=$|[^a-z0-9+#])`, "i");
    if (re.test(text)) found.push(skill);
  }
  return found;
}

/** http(s) links written in the text (no emails). Pure. */
export function linksInText(text: string): string[] {
  const raw = text.match(/https?:\/\/[^\s<>()"'\]]+/gi) ?? [];
  return [...new Set(raw.map((l) => safeHttpUrl(l.replace(/[.,;:]+$/, ""), 500)).filter(Boolean))].slice(0, 10);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

export type ResumeProject = { title: string; description: string; skills: string[]; link: string; year: string };
export type ResumeSuggestions = { headline: string; summary: string; skills: string[]; services: string[]; projects: ResumeProject[]; links: string[] };

/**
 * Keeps only what the resume supports: skills and project titles must appear in the
 * text, links must be written in it, contact details are removed. Pure.
 */
export function groundSuggestions(raw: Partial<ResumeSuggestions>, resume: string): { kept: ResumeSuggestions; dropped: string[] } {
  const hay = ` ${squash(resume)} `;
  const appears = (s: string) => { const t = squash(s); return t.length > 0 && (hay.includes(` ${t} `) || (t.length > 6 && hay.includes(t))); };
  const dropped: string[] = [];
  const clean = (s: unknown, max: number) => redactContactDetails(String(s ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
  const skillList = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => clean(x, 40)).filter(Boolean);
  const skills: string[] = [];
  for (const s of skillList(raw.skills)) {
    if (appears(s)) { if (!skills.some((k) => normaliseSkill(k) === normaliseSkill(s))) skills.push(s); } else dropped.push(`skill "${s}" is not in the resume`);
  }
  const links = (Array.isArray(raw.links) ? raw.links : []).map((l) => safeHttpUrl(l, 500)).filter((l) => l && resume.includes(l.replace(/\/$/, "")));
  const projects: ResumeProject[] = [];
  for (const p of Array.isArray(raw.projects) ? raw.projects.slice(0, MAX_PROJECTS) : []) {
    const title = clean(p?.title, 120);
    if (!title) continue;
    if (!appears(title)) { dropped.push(`project "${title}" is not in the resume`); continue; }
    const link = safeHttpUrl(p?.link, 500);
    projects.push({
      title,
      description: clean(p?.description, 600),
      skills: skillList(p?.skills).filter((s) => appears(s)).slice(0, 10),
      link: link && resume.includes(link.replace(/\/$/, "")) ? link : "",
      year: /^(19|20)\d{2}$/.test(String(p?.year ?? "")) ? String(p?.year) : ""
    });
  }
  let headline = clean(raw.headline, 120);
  let summary = clean(raw.summary, 1200);
  if (hasContact(headline)) { dropped.push("headline contained contact or payment details"); headline = ""; }
  if (hasContact(summary)) { dropped.push("summary contained contact or payment details"); summary = ""; }
  const services = skillList(raw.services).slice(0, 6);
  return { kept: { headline, summary, skills: skills.slice(0, 30), services, projects, links: [...new Set(links)].slice(0, 10) }, dropped };
}

function parseModelJson(text: string): Partial<ResumeSuggestions> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Partial<ResumeSuggestions>) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Projects list                                                       */
/* ------------------------------------------------------------------ */

export function validateProjects(input: unknown): { ok: true; items: ResumeProject[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: "items must be a list." };
  if (input.length > MAX_PROJECTS) return { ok: false, message: `Keep up to ${MAX_PROJECTS} projects.` };
  const items: ResumeProject[] = [];
  for (const [i, raw] of input.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = String(r.title ?? "").trim();
    const description = String(r.description ?? "").trim();
    if (title.length < 2 || title.length > 120) return { ok: false, message: `Project ${i + 1}: give it a title (2–120 characters).` };
    if (description.length > 1000) return { ok: false, message: `Project ${i + 1}: keep the description under 1,000 characters.` };
    if (hasContact(`${title} ${description}`)) return { ok: false, message: `Project ${i + 1}: keep emails, phone numbers and messaging apps out (clients contact you here).` };
    const linkRaw = String(r.link ?? "").trim();
    const link = linkRaw ? safeHttpUrl(linkRaw, 500) : "";
    if (linkRaw && !link) return { ok: false, message: `Project ${i + 1}: the link must start with https:// or http://.` };
    const year = String(r.year ?? "").trim();
    if (year && !/^(19|20)\d{2}$/.test(year)) return { ok: false, message: `Project ${i + 1}: year must be four digits.` };
    const skills = (Array.isArray(r.skills) ? r.skills : []).map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    items.push({ title, description, skills, link, year });
  }
  return { ok: true, items };
}

async function readProjects(sql: Queryable, userId: string): Promise<{ available: boolean; items: ResumeProject[] }> {
  const row = (await sql<Array<{ p: Record<string, unknown> }>>`SELECT to_jsonb(p) AS p FROM profiles p WHERE user_id = ${userId} LIMIT 1`)[0]?.p;
  if (!row || !("portfolio_items_json" in row)) return { available: false, items: [] };
  try {
    const parsed = JSON.parse(String(row.portfolio_items_json || "[]"));
    const v = validateProjects(parsed);
    return { available: true, items: v.ok ? v.items : [] };
  } catch {
    return { available: true, items: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export async function handleProfileRoute(request: Request, env: Env, requestId: string, deps: ProfileRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const known =
    (path === "/api/v1/profile/resume-extract" && method === "POST") ||
    (path === "/api/v1/me/portfolio-projects" && (method === "GET" || method === "PUT")) ||
    (path === "/api/v1/me/suggested-projects" && method === "GET");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (path === "/api/v1/me/portfolio-projects") {
      await loadProfile(sql, userId);
      if (method === "GET") return success(await readProjects(sql, userId), "Projects", 200, requestId);
      const current = await readProjects(sql, userId);
      if (!current.available) return failure("MIGRATION_PENDING", "Profile projects need database migration 0074.", 503, requestId);
      const v = validateProjects(((await body(request)) ?? {}).items);
      if (!v.ok) return failure("INVALID_PROJECTS", v.message, 422, requestId);
      await sql`UPDATE profiles SET portfolio_items_json = ${JSON.stringify(v.items)} WHERE user_id = ${userId}`;
      return success({ available: true, items: v.items }, "Projects saved", 200, requestId);
    }

    if (path === "/api/v1/me/suggested-projects") return success(await suggestedProjects(sql, userId), "Projects for you", 200, requestId);

    // ---------------- resume extract ----------------
    let resume = "";
    let source = "text";
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? "0") > MAX_RESUME_BYTES + 64 * 1024) return failure("FILE_TOO_LARGE", "Resumes can be up to 5 MB.", 413, requestId);
      let form: FormData;
      try { form = await request.formData(); } catch { return failure("INVALID_UPLOAD", "Send the resume in the form field \"file\".", 422, requestId); }
      const file = form.get("file");
      if (!file || typeof file === "string") return failure("INVALID_UPLOAD", "Choose a resume file.", 422, requestId);
      if (file.size > MAX_RESUME_BYTES) return failure("FILE_TOO_LARGE", "Resumes can be up to 5 MB.", 413, requestId);
      const name = file.name.toLowerCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        try { resume = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return failure("UNREADABLE_FILE", "That text file is not valid UTF-8 text.", 422, requestId); }
        source = "text_file";
      } else if (name.endsWith(".docx")) {
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return failure("UNREADABLE_FILE", "That is not a Word (.docx) file.", 422, requestId);
        resume = (await docxText(bytes).catch(() => null)) ?? "";
        if (!resume) return failure("UNREADABLE_FILE", "Could not read text from that Word file. Paste the text instead.", 422, requestId);
        source = "docx";
      } else if (name.endsWith(".pdf")) {
        if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return failure("UNREADABLE_FILE", "That is not a PDF file.", 422, requestId);
        const toMarkdown = (env.AI as unknown as { toMarkdown?: ToMarkdown } | undefined)?.toMarkdown;
        if (!toMarkdown) return failure("PDF_NOT_SUPPORTED", "PDF reading is not available right now. Upload a Word (.docx) file or paste the text.", 422, requestId);
        try {
          const out = await toMarkdown.call(env.AI, [{ name: "resume.pdf", blob: new Blob([bytes], { type: "application/pdf" }) }]);
          resume = String(out?.[0]?.data ?? "");
        } catch {
          resume = "";
        }
        if (resume.trim().length < 40) return failure("UNREADABLE_FILE", "Could not read text from that PDF (it may be a scanned image). Paste the text instead.", 422, requestId);
        source = "pdf";
      } else {
        return failure("FILE_TYPE_NOT_ALLOWED", "Upload a PDF, Word (.docx) or text file, or paste the text.", 422, requestId);
      }
    } else {
      const payload = (await body(request)) ?? {};
      resume = typeof payload.text === "string" ? payload.text : "";
    }
    resume = resume.replace(/\u0000/g, "").slice(0, MAX_RESUME_CHARS);
    if (resume.trim().length < 40) return failure("RESUME_TOO_SHORT", "Paste or upload at least a few lines of your resume.", 422, requestId);

    const rules: ResumeSuggestions = { headline: "", summary: "", skills: skillsInText(resume), services: [], projects: [], links: linksInText(resume) };
    let mode: "model" | "rules" = "rules";
    let note = "";
    let suggestions = rules;
    let dropped: string[] = [];

    const fenceId = newFenceId();
    const system =
      "You extract facts from a freelancer's resume for their marketplace profile. " + fenceInstruction(fenceId) + " " +
      "Return ONLY JSON: {\"headline\": string (<= 100 chars, their role), \"summary\": string (<= 3 sentences, only facts in the resume), " +
      "\"skills\": [strings named in the resume], \"services\": [up to 6 short service names they could offer], " +
      "\"projects\": [{\"title\", \"description\" (what they did, <= 2 sentences), \"skills\": [], \"link\", \"year\"}], \"links\": [urls written in the resume]}. " +
      "Never invent a skill, project, employer, number or link. Never include names, emails, phone numbers or addresses.";
    const prompt = `RESUME:\n${fenceUntrusted("resume", redactContactDetails(resume), fenceId, 12_000)}`;
    const decision = await reserveAiCall(env, sql, { userId, operation: "resume_extract", inputChars: system.length + prompt.length, maxOutputTokens: 1200 });
    if (decision.allowed && env.AI) {
      try {
        const result = (await env.AI.run(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          max_tokens: 1200
        })) as { response?: string } | null;
        const out = result?.response ?? "";
        await settleAiCall(env, sql, decision.eventId, system.length + prompt.length, out.length);
        const parsed = parseModelJson(out);
        if (parsed) {
          const grounded = groundSuggestions(parsed, resume);
          dropped = grounded.dropped;
          const skills = [...grounded.kept.skills];
          for (const s of rules.skills) if (!skills.some((k) => normaliseSkill(k) === normaliseSkill(s))) skills.push(s);
          suggestions = { ...grounded.kept, skills: skills.slice(0, 30), links: [...new Set([...grounded.kept.links, ...rules.links])].slice(0, 10) };
          mode = "model";
        } else note = "The AI answer could not be read, so only the rules-based reading is shown.";
      } catch {
        note = "The AI reader failed, so only the rules-based reading is shown.";
      }
    } else {
      note = decision.allowed ? "" : `${decision.message.replace(/ A template was used instead\./, "")} Skills and links were found by rules; add projects yourself.`;
    }
    await sql`
      INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
      VALUES (${crypto.randomUUID()}, ${userId}, 'profile_coach', 'completed',
              ${`Resume read (${source}, ${mode}): ${suggestions.skills.length} skills, ${suggestions.projects.length} projects suggested; ${dropped.length} unsupported items dropped. Nothing saved.`}, now())
    `.catch(() => undefined);
    return success({ mode, source, characters: resume.length, suggestions, dropped, note, saved: false }, "Review the suggestions, then save what is right", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ------------------------------------------------------------------ */
/* Projects for you                                                    */
/* ------------------------------------------------------------------ */

async function suggestedProjects(sql: Queryable, userId: string) {
  const profile = (await sql<Array<Record<string, unknown>>>`
    SELECT p.*, u.created_at AS user_created_at FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ${userId} LIMIT 1
  `)[0];
  if (!profile) return { native: [], external: [], note: "Fill in your profile first." };
  // Skills the person showed in their own projects count alongside the profile's skill list.
  const skills = jsonList(profile.skills);
  try {
    const items = validateProjects(JSON.parse(String(profile.portfolio_items_json ?? "[]")));
    if (items.ok) for (const p of items.items) for (const s of p.skills) if (!skills.some((k) => normaliseSkill(k) === normaliseSkill(s))) skills.push(s);
  } catch {
    // malformed list: profile skills only
  }
  const row: CandidateRow = {
    user_id: userId, full_name: String(profile.full_name ?? ""), headline: String(profile.headline ?? ""), skills: JSON.stringify(skills),
    services: String(profile.services ?? "[]"), minimum_budget: profile.minimum_budget as number | null, hourly_rate: profile.hourly_rate as number | null,
    currency: String(profile.currency ?? "INR"), weekly_hours: profile.weekly_hours as number | null, timezone: String(profile.timezone ?? ""),
    dealbreakers: String(profile.dealbreakers ?? "[]"), user_created_at: profile.user_created_at as Date
  };
  const now = new Date();
  const listings = await sql<Array<Record<string, unknown>>>`
    SELECT l.id, l.organization_id, l.category_slug, v.title, v.outcome, v.description, v.skills_json, v.budget_model, v.budget_min_minor,
           v.budget_max_minor, v.currency, v.timezone, v.confidentiality, c.name AS category_name, o.name AS client_name
    FROM project_listings l
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    JOIN organizations o ON o.id = l.organization_id
    LEFT JOIN project_categories c ON c.slug = l.category_slug
    WHERE l.status = 'published' AND l.visibility = 'public' AND o.status = 'active' AND (l.closes_at IS NULL OR l.closes_at > now())
      AND NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = l.organization_id AND m.user_id = ${userId} AND m.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM listing_proposals lp WHERE lp.listing_id = l.id AND lp.freelancer_user_id = ${userId})
    ORDER BY l.published_at DESC
    LIMIT 200
  `.catch(() => [] as Array<Record<string, unknown>>);
  const native = listings
    .map((l) => {
      const target: ListingForMatch = {
        title: String(l.title), outcome: String(l.outcome ?? ""), description: l.confidentiality === "confidential" ? "" : String(l.description ?? ""),
        category_slug: String(l.category_slug), category_name: String(l.category_name ?? l.category_slug), skills: jsonList(l.skills_json),
        budget_model: String(l.budget_model), budget_min_minor: l.budget_min_minor === null ? null : Number(l.budget_min_minor),
        budget_max_minor: l.budget_max_minor === null ? null : Number(l.budget_max_minor), currency: String(l.currency), timezone: String(l.timezone ?? "")
      };
      const e = evaluateCandidate(target, row, now);
      return e.eligible ? { id: String(l.id), title: target.title, client_name: l.confidentiality === "confidential" ? "Confidential client" : String(l.client_name ?? ""), score: e.match.score, reasons: e.match.reasons, missing_skills: e.match.missing_skills } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const external = await sql<Array<{ id: string; title: string; source: string; match_score: number | null; score_breakdown: string }>>`
    SELECT id, title, source, match_score, score_breakdown FROM opportunities
    WHERE user_id = ${userId} AND status IN ('new', 'drafted') ORDER BY match_score DESC NULLS LAST, created_at DESC LIMIT 10
  `.catch(() => []);
  return {
    native,
    external: external.map((o) => {
      let matched: string[] = [];
      try { matched = (JSON.parse(o.score_breakdown || "{}")?.notes?.matched_skills as string[]) ?? []; } catch { matched = []; }
      return { id: o.id, title: o.title, source: o.source, score: o.match_score ?? 0, reasons: matched.length ? [`Matches your skills: ${matched.slice(0, 6).join(", ")}`] : [] };
    }),
    note: native.length || external.length ? "" : "No matches yet. Add skills and projects, then search for work."
  };
}
