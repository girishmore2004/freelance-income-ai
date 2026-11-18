import { describe, expect, it } from "vitest";
import { docxText, groundSuggestions, handleProfileRoute, linksInText, readZipEntry, skillsInText, validateProjects } from "./profile-routes";
import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import type { Sql } from "./core-routes";

const RESUME = `Senior Next.js developer, 6 years.
Projects
Bakery Ordering Website - built with Next.js, Stripe and PostgreSQL. https://bakery.example.com
Inventory Dashboard - React and Python FastAPI.
Contact: ravi@example.com +91 98765 43210`;

/** A minimal ZIP with one stored (method 0) entry. */
function storedZip(name: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const n = enc.encode(name);
  const data = enc.encode(content);
  const local = new Uint8Array(30 + n.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 0, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  local.set(data, 30 + n.length);
  const central = new Uint8Array(46 + n.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  central.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

describe("resume reading", () => {
  it("finds vocabulary skills and written links, nothing else", () => {
    const skills = skillsInText(RESUME);
    expect(skills).toEqual(expect.arrayContaining(["Next.js", "Stripe", "PostgreSQL", "React", "Python", "FastAPI"]));
    expect(skills).not.toContain("Java");
    expect(skills).not.toContain("Go");
    expect(linksInText(RESUME)).toEqual(["https://bakery.example.com/"]);
    expect(linksInText("mail ravi@example.com or javascript:alert(1)")).toEqual([]);
  });

  it("reads the body text of a Word file", async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Ravi &amp; Co</w:t></w:r></w:p><w:p><w:r><w:t>Skills: React</w:t></w:r></w:p></w:body></w:document>';
    const zip = storedZip("word/document.xml", xml);
    expect(new TextDecoder().decode((await readZipEntry(zip, "word/document.xml")) ?? new Uint8Array())).toBe(xml);
    expect(await readZipEntry(zip, "missing.xml")).toBeNull();
    expect(await docxText(zip)).toBe("Ravi & Co\nSkills: React");
    expect(await docxText(new TextEncoder().encode("not a zip"))).toBeNull();
  });

  it("keeps only what the resume supports and strips contact details", () => {
    const { kept, dropped } = groundSuggestions(
      {
        headline: "Next.js developer",
        summary: "Builds shops. Email ravi@example.com",
        skills: ["Next.js", "Kubernetes", "stripe"],
        services: ["Online stores"],
        projects: [
          { title: "Bakery Ordering Website", description: "Ordering site", skills: ["Next.js", "Vue"], link: "https://bakery.example.com", year: "2024" },
          { title: "Mobile banking app", description: "Invented", skills: [], link: "", year: "" }
        ],
        links: ["https://bakery.example.com", "https://made-up.example.com"]
      },
      RESUME
    );
    expect(kept.skills).toEqual(["Next.js", "stripe"]);
    expect(kept.summary).not.toContain("@");
    expect(kept.projects).toHaveLength(1);
    expect(kept.projects[0]).toEqual({ title: "Bakery Ordering Website", description: "Ordering site", skills: ["Next.js"], link: "https://bakery.example.com/", year: "2024" });
    expect(kept.links).toEqual(["https://bakery.example.com/"]);
    expect(dropped).toEqual(expect.arrayContaining(['skill "Kubernetes" is not in the resume', 'project "Mobile banking app" is not in the resume']));
  });
});

describe("profile projects", () => {
  it("validates titles, links, years and contact details", () => {
    expect(validateProjects("x")).toMatchObject({ ok: false });
    expect(validateProjects([{ title: "A" }])).toMatchObject({ ok: false });
    expect(validateProjects([{ title: "Shop", link: "javascript:alert(1)" }])).toMatchObject({ ok: false });
    expect(validateProjects([{ title: "Shop", year: "24" }])).toMatchObject({ ok: false });
    expect(validateProjects([{ title: "Shop", description: "WhatsApp me" }])).toMatchObject({ ok: false });
    expect(validateProjects(Array.from({ length: 21 }, () => ({ title: "Shop" })))).toMatchObject({ ok: false });
    expect(validateProjects([{ title: " Crypto wallet UI ", description: "Bitcoin price widgets", skills: ["React", "", "Figma"], link: "https://x.dev", year: "2023" }]))
      .toEqual({ ok: true, items: [{ title: "Crypto wallet UI", description: "Bitcoin price widgets", skills: ["React", "Figma"], link: "https://x.dev/", year: "2023" }] });
  });
});

type Call = { text: string; values: unknown[] };
function fakeSql(responder: (text: string) => unknown[]): { sql: Sql; calls: Call[] } {
  const calls: Call[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    const p = Promise.resolve(responder(text));
    return Object.assign(p, { catch: p.catch.bind(p) });
  };
  Object.assign(tag, { end: async () => undefined });
  return { sql: tag as unknown as Sql, calls };
}

const session = { user: { id: "u1", email: "a@b.c" } } as unknown as AuthenticatedSession;
const env = {} as Env;

describe("profile routes", () => {
  it("ignores other paths and needs sign-in", async () => {
    const { sql } = fakeSql(() => []);
    const deps = { database: () => sql, authenticate: async () => new Response("no", { status: 401 }) };
    expect(await handleProfileRoute(new Request("https://x/api/v1/profile"), env, "r", deps)).toBeNull();
    expect((await handleProfileRoute(new Request("https://x/api/v1/me/portfolio-projects"), env, "r", deps))?.status).toBe(401);
  });

  it("reads pasted text with rules when no AI is configured and saves nothing", async () => {
    const { sql, calls } = fakeSql(() => []);
    const res = await handleProfileRoute(
      new Request("https://x/api/v1/profile/resume-extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: RESUME }) }),
      env, "r", { database: () => sql, authenticate: async () => session }
    );
    expect(res?.status).toBe(200);
    const json = (await res!.json()) as { data: { mode: string; saved: boolean; suggestions: { skills: string[]; links: string[] }; note: string } };
    expect(json.data.mode).toBe("rules");
    expect(json.data.saved).toBe(false);
    expect(json.data.suggestions.skills).toContain("Next.js");
    expect(json.data.note).toContain("No AI provider is configured.");
    expect(calls.some((c) => /UPDATE profiles/.test(c.text))).toBe(false);
    expect(calls.some((c) => /INSERT INTO agent_runs/.test(c.text))).toBe(true);
  });

  it("rejects too-short text and unknown file types", async () => {
    const { sql } = fakeSql(() => []);
    const deps = { database: () => sql, authenticate: async () => session };
    const short = await handleProfileRoute(new Request("https://x/api/v1/profile/resume-extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) }), env, "r", deps);
    expect(short?.status).toBe(422);
    const form = new FormData();
    form.set("file", new File(["MZ"], "resume.exe"));
    const exe = await handleProfileRoute(new Request("https://x/api/v1/profile/resume-extract", { method: "POST", body: form }), env, "r", deps);
    expect(exe?.status).toBe(422);
    const pdf = new FormData();
    pdf.set("file", new File(["%PDF-1.4 fake"], "cv.pdf"));
    const noPdf = await handleProfileRoute(new Request("https://x/api/v1/profile/resume-extract", { method: "POST", body: pdf }), env, "r", deps);
    expect(noPdf?.status).toBe(422);
    expect(((await noPdf!.json()) as { error: { code: string } }).error.code).toBe("PDF_NOT_SUPPORTED");
  });

  it("refuses to save projects before migration 0074", async () => {
    const { sql } = fakeSql((text) => (/to_jsonb\(p\)/.test(text) ? [{ p: { user_id: "u1" } }] : /SELECT \* FROM profiles/.test(text) ? [{ user_id: "u1" }] : []));
    const res = await handleProfileRoute(new Request("https://x/api/v1/me/portfolio-projects", { method: "PUT", body: JSON.stringify({ items: [] }) }), env, "r", { database: () => sql, authenticate: async () => session });
    expect(res?.status).toBe(503);
  });

  it("saves validated projects", async () => {
    const { sql, calls } = fakeSql((text) => (/to_jsonb\(p\)/.test(text) ? [{ p: { user_id: "u1", portfolio_items_json: "[]" } }] : /SELECT \* FROM profiles/.test(text) ? [{ user_id: "u1" }] : []));
    const res = await handleProfileRoute(
      new Request("https://x/api/v1/me/portfolio-projects", { method: "PUT", body: JSON.stringify({ items: [{ title: "Bakery site", skills: ["Next.js"] }] }) }),
      env, "r", { database: () => sql, authenticate: async () => session }
    );
    expect(res?.status).toBe(200);
    const update = calls.find((c) => /UPDATE profiles SET portfolio_items_json/.test(c.text));
    expect(JSON.parse(String(update?.values[0]))).toEqual([{ title: "Bakery site", description: "", skills: ["Next.js"], link: "", year: "" }]);
  });
});
