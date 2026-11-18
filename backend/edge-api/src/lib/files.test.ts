import { describe, expect, it } from "vitest";
import type { Env, R2BucketBinding } from "../types";
import { bytesMatch, handleFileRoute, safeFilename, MAX_FILE_BYTES } from "./file-routes";
import type { FileRouteDeps } from "./file-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function fakeBucket() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const bucket: R2BucketBinding = {
    async put(key, value) { objects.set(key, new Uint8Array(value)); return {}; },
    async get(key) {
      const v = objects.get(key);
      return v ? { body: new Response(v).body as ReadableStream, size: v.byteLength } : null;
    },
    async delete(key) { objects.delete(key); }
  };
  return { bucket, objects };
}

interface World { user?: string; memberRole?: string | null; contractStatus?: string; uploadedBy?: string; submissionId?: string | null; usage?: number; roles?: string[] }

function world(o: World = {}) {
  const user = o.user ?? "f1";
  const fileRow = { id: "F1", contract_id: "K1", uploaded_by: o.uploadedBy ?? "f1", party: "freelancer", submission_id: o.submissionId ?? null, r2_key: "contracts/K1/F1", filename: "Design v1.pdf", content_type: "application/pdf", size_bytes: PDF.byteLength, sha256: "0".repeat(64), status: "ready", created_at: new Date() };
  const fake = createFakeSql((text, values) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.startsWith("SELECT * FROM contracts")) return [{ id: "K1", organization_id: "o1", freelancer_user_id: "f1", status: o.contractStatus ?? "active" }];
    if (text.includes("FROM organization_memberships m")) return o.memberRole === null || o.memberRole === undefined ? [] : [{ id: "o1", membership_role: o.memberRole }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return (o.roles ?? ["freelancer"]).map((role) => ({ role, status: "active" }));
    if (text.startsWith("SELECT * FROM contract_files WHERE id")) return [fileRow];
    if (text.startsWith("SELECT * FROM contract_files WHERE contract_id")) return [fileRow];
    if (text.startsWith("SELECT count(*)::int AS n, COALESCE(sum(size_bytes), 0) AS bytes")) return [{ n: o.usage ?? 0, bytes: 0 }];
    if (text.startsWith("INSERT INTO contract_files")) return [{ ...fileRow, id: values[0], filename: values[5], content_type: values[6], size_bytes: values[7] }];
    if (text.startsWith("UPDATE contract_files SET status = 'deleted'")) return fileRow.submission_id ? [] : [{ id: "F1" }];
    return [];
  });
  const deps: FileRouteDeps = { database: () => fake.sql, authenticate: async () => session(user) };
  return { fake, deps };
}

function upload(name: string, bytes: Uint8Array<ArrayBuffer>): Request {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  return new Request("https://api.example.test/api/v1/contracts/K1/files", { method: "POST", body: form });
}

describe("file checks", () => {
  it("detects real types from bytes and refuses disguised files", () => {
    expect(bytesMatch("pdf", PDF)).toBe(true);
    expect(bytesMatch("png", PNG)).toBe(true);
    expect(bytesMatch("pdf", PNG)).toBe(false);
    expect(bytesMatch("text", new TextEncoder().encode("hello, world"))).toBe(true);
    expect(bytesMatch("text", PNG)).toBe(false);
    expect(bytesMatch("zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]))).toBe(true);
  });

  it("keeps safe names and refuses unknown extensions", () => {
    expect(safeFilename("../../etc/Design v1.PDF")).toEqual({ name: "Design v1.pdf", ext: "pdf" });
    expect(safeFilename('a"<b>.png')!.name).toBe("ab.png");
    expect(safeFilename("run.exe")).toBeNull();
    expect(safeFilename("page.html")).toBeNull();
    expect(safeFilename("noext")).toBeNull();
  });
});

describe("uploads", () => {
  it("stores the bytes in R2 and the metadata in the database, with a server-chosen type", async () => {
    const { bucket, objects } = fakeBucket();
    const w = world();
    const res = await handleFileRoute(upload("Design v1.pdf", PDF), { FILES: bucket } as Env, "r", w.deps);
    expect(res!.status).toBe(201);
    expect(objects.size).toBe(1);
    const [key] = [...objects.keys()];
    expect(key).toMatch(/^contracts\/K1\/[0-9a-f-]{36}$/);
    const insert = w.fake.queries.find((q) => q.text.startsWith("INSERT INTO contract_files"))!;
    expect(insert.values).toContain("application/pdf");
    expect(w.fake.queries.some((q) => q.text.startsWith("INSERT INTO contract_events") && q.values.includes("file.uploaded"))).toBe(true);
  });

  it("refuses disguised, oversized, wrong-type uploads and full contracts", async () => {
    const { bucket, objects } = fakeBucket();
    const env = { FILES: bucket } as Env;
    expect((await readJson((await handleFileRoute(upload("photo.pdf", PNG), env, "r", world().deps))!)).error!.code).toBe("FILE_TYPE_MISMATCH");
    expect((await readJson((await handleFileRoute(upload("tool.exe", PDF), env, "r", world().deps))!)).error!.code).toBe("FILE_TYPE_NOT_ALLOWED");
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(PDF);
    expect((await handleFileRoute(upload("big.pdf", big), env, "r", world().deps))!.status).toBe(413);
    expect((await handleFileRoute(upload("a.pdf", PDF), env, "r", world({ usage: 100 }).deps))!.status).toBe(429);
    expect(objects.size).toBe(0);
  });

  it("answers 503 without the bucket, and enforces parties and contract state", async () => {
    expect((await readJson((await handleFileRoute(upload("a.pdf", PDF), {} as Env, "r", world().deps))!)).error!.code).toBe("FILES_NOT_CONFIGURED");
    const env = { FILES: fakeBucket().bucket } as Env;
    expect((await handleFileRoute(upload("a.pdf", PDF), env, "r", world({ user: "x" }).deps))!.status).toBe(404);
    expect((await handleFileRoute(upload("a.pdf", PDF), env, "r", world({ user: "c2", memberRole: "member" }).deps))!.status).toBe(403);
    expect((await handleFileRoute(upload("a.pdf", PDF), env, "r", world({ user: "c1", memberRole: "owner" }).deps))!.status).toBe(201);
    expect((await handleFileRoute(upload("a.pdf", PDF), env, "r", world({ contractStatus: "completed" }).deps))!.status).toBe(409);
  });
});

describe("downloads and deletion", () => {
  it("serves files as attachments that cannot run in the app, to parties and staff only", async () => {
    const { bucket } = fakeBucket();
    await bucket.put("contracts/K1/F1", PDF);
    const env = { FILES: bucket } as Env;
    const res = await handleFileRoute(jsonRequest("GET", "/api/v1/files/F1"), env, "r", world({ user: "c1", memberRole: "member" }).deps);
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Disposition")).toContain("attachment");
    expect(res!.headers.get("Content-Disposition")).toContain("filename*=UTF-8''Design%20v1.pdf");
    expect(res!.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res!.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(PDF);
    expect((await handleFileRoute(jsonRequest("GET", "/api/v1/files/F1"), env, "r", world({ user: "x" }).deps))!.status).toBe(404);
    expect((await handleFileRoute(jsonRequest("GET", "/api/v1/files/F1"), env, "r", world({ user: "mod1", roles: ["moderator"] }).deps))!.status).toBe(200);
  });

  it("lets only the uploader delete, and never a file that is part of a delivery", async () => {
    const { bucket, objects } = fakeBucket();
    await bucket.put("contracts/K1/F1", PDF);
    const env = { FILES: bucket } as Env;
    expect((await handleFileRoute(jsonRequest("POST", "/api/v1/files/F1/delete", {}), env, "r", world({ user: "c1", memberRole: "owner" }).deps))!.status).toBe(403);
    expect((await handleFileRoute(jsonRequest("POST", "/api/v1/files/F1/delete", {}), env, "r", world({ submissionId: "S1" }).deps))!.status).toBe(409);
    expect(objects.size).toBe(1);
    expect((await handleFileRoute(jsonRequest("POST", "/api/v1/files/F1/delete", {}), env, "r", world().deps))!.status).toBe(200);
    expect(objects.size).toBe(0);
  });
});
