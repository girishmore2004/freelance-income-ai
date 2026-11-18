import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { listingFileAccess, handleListingFileRoute } from "./listing-file-routes";
import { validateEvidence, handleVerificationRoute } from "./verification-routes";
import { sourceHealth, handleSourceRoute } from "./source-routes";
import { SOURCE_CATALOGUE } from "./discovery-agent";
import { createFakeSql, jsonRequest } from "./test-support";

const NOW = new Date("2026-11-18T10:00:00Z");
const session = (id: string) => async () => ({ user: { id, email: `${id}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: id, jti: "j", iat: 0, exp: 0 } }) as never;

describe("listing file access", () => {
  const live = { status: "published", visibility: "public", closes_at: null, confidentiality: "standard", org_status: "active" };
  const nobody = { membershipRole: null, invited: false, proposed: false };

  it("lets members see and owners/admins manage", () => {
    expect(listingFileAccess({ ...live, status: "draft" }, { ...nobody, membershipRole: "member" }, NOW)).toEqual({ member: true, canManage: false, canView: true });
    expect(listingFileAccess(live, { ...nobody, membershipRole: "admin" }, NOW).canManage).toBe(true);
  });

  it("shows files to freelancers only on live, visible projects", () => {
    expect(listingFileAccess(live, nobody, NOW).canView).toBe(true);
    expect(listingFileAccess({ ...live, status: "draft" }, nobody, NOW).canView).toBe(false);
    expect(listingFileAccess({ ...live, closes_at: "2026-11-01T00:00:00Z" }, nobody, NOW).canView).toBe(false);
    expect(listingFileAccess({ ...live, org_status: "suspended" }, nobody, NOW).canView).toBe(false);
    expect(listingFileAccess({ ...live, visibility: "invite_only" }, nobody, NOW).canView).toBe(false);
    expect(listingFileAccess({ ...live, visibility: "invite_only" }, { ...nobody, invited: true }, NOW).canView).toBe(true);
  });

  it("keeps confidential files for invited freelancers and those who proposed", () => {
    const conf = { ...live, confidentiality: "confidential" };
    expect(listingFileAccess(conf, nobody, NOW).canView).toBe(false);
    expect(listingFileAccess(conf, { ...nobody, proposed: true }, NOW).canView).toBe(true);
    expect(listingFileAccess({ ...conf, status: "hiring" }, { ...nobody, invited: true }, NOW).canView).toBe(true);
    // A freelancer who proposed keeps access after the project closes.
    expect(listingFileAccess({ ...live, status: "closed" }, { ...nobody, proposed: true }, NOW).canView).toBe(true);
  });
});

describe("verification evidence", () => {
  it("needs 1–5 full http(s) links and a sane registration number", () => {
    expect(validateEvidence({ links: [] })).toMatchObject({ ok: false, errors: { links: "Add at least one http(s) link to your work, profile or business website." } });
    expect(validateEvidence({ links: ["javascript:alert(1)"] })).toMatchObject({ ok: false });
    expect(validateEvidence({ links: ["https://a.test", "ftp://b.test"] })).toMatchObject({ ok: false, errors: { links: "Every link must be a full http(s) address." } });
    expect(validateEvidence({ links: Array.from({ length: 6 }, (_, i) => `https://a${i}.test`) })).toMatchObject({ ok: false });
    expect(validateEvidence({ links: ["https://a.test"], registration_number: "<script>" })).toMatchObject({ ok: false });
    const ok = validateEvidence({ links: ["https://github.com/me", "https://github.com/me"], note: " my work ", registration_number: "U72900MH2020PTC123456" });
    expect(ok).toEqual({ ok: true, value: { links: ["https://github.com/me"], note: "my work", registration_number: "U72900MH2020PTC123456" } });
  });
});

describe("source health", () => {
  it("summarises the last 7 days", () => {
    expect(sourceHealth(false, 5, 0, false)).toBe("off");
    expect(sourceHealth(true, 0, 0, false)).toBe("no_runs");
    expect(sourceHealth(true, 4, 4, true)).toBe("failing");
    expect(sourceHealth(true, 4, 2, true)).toBe("failing");
    expect(sourceHealth(true, 4, 1, false)).toBe("partly_failing");
    expect(sourceHealth(true, 4, 0, false)).toBe("healthy");
  });

  it("lists every discovery source exactly once", () => {
    const codes = SOURCE_CATALOGUE.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual(["freelancer", "hackernews", "himalayas", "jobicy", "reddit", "remoteok", "remotive"]);
  });
});

describe("U10 routes", () => {
  const env = {} as Env;
  const fake = (rows: (q: string) => unknown[]) => () => createFakeSql((q) => rows(q)).sql;

  it("hides staff queues from non-staff", async () => {
    const deps = { database: fake((q) => (q.includes("FROM user_roles") ? [{ role: "freelancer" }] : q.includes("to_regclass") ? [{ ready: true }] : [])), authenticate: session("f1") };
    expect((await handleVerificationRoute(jsonRequest("GET", "/api/v1/admin/verifications"), env, "r", deps))?.status).toBe(404);
    expect((await handleSourceRoute(jsonRequest("GET", "/api/v1/admin/sources"), env, "r", deps))?.status).toBe(404);
  });

  it("answers my verification status before migration 0071 without failing", async () => {
    const deps = { database: fake((q) => (q.includes("to_regclass") ? [{ ready: false }] : [])), authenticate: session("f1") };
    const res = await handleVerificationRoute(jsonRequest("GET", "/api/v1/me/verification"), env, "r", deps);
    expect(res?.status).toBe(200);
    expect(((await res!.json()) as { data: { available: boolean } }).data.available).toBe(false);
  });

  it("ignores paths it does not own", async () => {
    const deps = { database: fake(() => []), authenticate: session("f1") };
    expect(await handleListingFileRoute(jsonRequest("GET", "/api/v1/listings/L1"), env, "r", deps)).toBeNull();
    expect(await handleListingFileRoute(jsonRequest("GET", "/api/v1/marketplace/listings/L1"), env, "r", deps)).toBeNull();
    expect(await handleSourceRoute(jsonRequest("POST", "/api/v1/admin/sources"), env, "r", deps)).toBeNull();
  });
});
