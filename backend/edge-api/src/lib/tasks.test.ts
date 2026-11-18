import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleTaskRoute, looksSecret, planFromStages, validateHandover, validateTask } from "./task-routes";
import { createFakeSql, jsonRequest } from "./test-support";

const fields = (r: { ok: boolean; errors?: Record<string, string> }) => (r.ok ? [] : Object.keys(r.errors ?? {}));

describe("category plan", () => {
  const milestones = [{ title: "Design", amount_minor: 100, due_date: "2026-12-01" }, { title: "Build", amount_minor: 200, due_date: "2026-12-20" }];
  it("spreads stages over milestones in order and gives review stages to the client", () => {
    const plan = planFromStages(["Requirements", "Design", "Development", "Testing", "Client approval", "Deployment"], milestones);
    expect(plan.map((p) => `${p.title}:${p.owner_party}:${p.milestone_index}:${p.due_date}`)).toEqual([
      "Requirements:client:0:2026-12-01", "Design:freelancer:0:2026-12-01", "Development:freelancer:0:2026-12-01",
      "Testing:freelancer:1:2026-12-20", "Client approval:client:1:2026-12-20", "Deployment:freelancer:1:2026-12-20"
    ]);
    expect(planFromStages(["A", " ", "B"], []).map((p) => [p.title, p.milestone_index, p.position])).toEqual([["A", null, 0], ["B", null, 1]]);
    expect(planFromStages([], milestones)).toEqual([]);
  });
});

describe("task validation", () => {
  it("checks titles, milestones, dates and statuses", () => {
    expect(fields(validateTask({ title: "x" }, 2, false))).toContain("title");
    expect(validateTask({ title: "Call me on 98765 43210" }, 2, false)).toMatchObject({ ok: false });
    expect(validateTask({ title: "Set up staging", milestone_index: 2 }, 2, false)).toMatchObject({ ok: false, errors: { milestone_index: "Choose one of the contract's milestones." } });
    expect(validateTask({ title: "Set up staging", due_date: "next week" }, 2, false)).toMatchObject({ ok: false });
    expect(validateTask({ status: "blocked" }, 2, true)).toMatchObject({ ok: false });
    expect(validateTask({ title: "Set up staging", milestone_index: 1, due_date: "2026-12-05" }, 2, false)).toEqual({ ok: true, value: { title: "Set up staging", owner_party: "freelancer", milestone_index: 1, due_date: "2026-12-05" } });
    expect(validateTask({ status: "done", due_date: "" }, 2, true)).toEqual({ ok: true, value: { status: "done", due_date: null } });
  });
});

describe("handover safety", () => {
  it("refuses secrets and contact details, accepts plain https links", () => {
    for (const s of ["password: hunter2", "API key = abc", "-----BEGIN RSA PRIVATE KEY-----", "ghp_abcdefghijklmnop1234", "token=xyz"]) expect(looksSecret(s)).toBe(true);
    expect(looksSecret("Documentation for resetting your password in the admin")).toBe(false);
    expect(fields(validateHandover({ kind: "access_transfer", title: "Hosting", note: "pwd: abc123" }))).toContain("note");
    expect(fields(validateHandover({ kind: "source_files", title: "Repo", link: "https://user:pw@github.com/x" }))).toContain("link");
    expect(fields(validateHandover({ kind: "keys", title: "Repo" }))).toContain("kind");
    expect(validateHandover({ kind: "source_files", title: "Repository", link: "https://github.com/acme/site", note: "Transferred ownership to Acme's GitHub org." }))
      .toEqual({ ok: true, value: { kind: "source_files", title: "Repository", link: "https://github.com/acme/site", note: "Transferred ownership to Acme's GitHub org." } });
  });
});

describe("task routes", () => {
  it("leaves other contract paths alone", async () => {
    const deps = { database: () => createFakeSql(() => []).sql, authenticate: async () => ({ user: { id: "u" } }) as never };
    const env = {} as Env;
    for (const p of ["/api/v1/contracts/K1/workspace", "/api/v1/contracts/K1/files", "/api/v1/contracts/K1"]) {
      expect(await handleTaskRoute(jsonRequest("GET", p), env, "r", deps)).toBeNull();
    }
    expect(await handleTaskRoute(jsonRequest("GET", "/api/v1/contracts/K1/tasks/plan"), env, "r", deps)).toBeNull();
  });
});
