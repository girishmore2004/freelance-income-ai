import type { Env, R2BucketBinding } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { database, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import type { ContractRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";

/**
 * Contract file attachments in Cloudflare R2 (binding `FILES`).
 *
 * Parties (client organisation members, or the freelancer)
 *   GET  /api/v1/contracts/{id}/files                list (newest first)
 *   POST /api/v1/contracts/{id}/files                multipart field `file`; active contracts; client owners/admins or the freelancer
 *   GET  /api/v1/files/{id}                          download (parties; staff for dispute review)
 *   POST /api/v1/files/{id}/delete                   uploader only, while not attached to a delivery
 *
 * Safety: an allow-list of extensions, the type is detected from the bytes
 * (never trusted from the browser), 10 MB per file, 100 files and 200 MB per
 * contract. Downloads are always `attachment` with `nosniff` and a sandboxing
 * CSP, so nothing uploaded can run in the app's origin. There is no malware
 * scanning yet (K-32): files are passed between the two parties of a contract
 * only. Without the `FILES` binding every write answers 503 FILES_NOT_CONFIGURED.
 */

export interface FileRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: FileRouteDeps = { database, authenticate: authenticateRequest };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_CONTRACT = 100;
export const MAX_BYTES_PER_CONTRACT = 200 * 1024 * 1024;

type Kind = "pdf" | "png" | "jpeg" | "gif" | "webp" | "zip" | "text";
const EXTENSIONS: Record<string, { kind: Kind; type: string }> = {
  pdf: { kind: "pdf", type: "application/pdf" },
  png: { kind: "png", type: "image/png" },
  jpg: { kind: "jpeg", type: "image/jpeg" },
  jpeg: { kind: "jpeg", type: "image/jpeg" },
  gif: { kind: "gif", type: "image/gif" },
  webp: { kind: "webp", type: "image/webp" },
  zip: { kind: "zip", type: "application/zip" },
  docx: { kind: "zip", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { kind: "zip", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pptx: { kind: "zip", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  txt: { kind: "text", type: "text/plain; charset=utf-8" },
  csv: { kind: "text", type: "text/csv; charset=utf-8" },
  md: { kind: "text", type: "text/markdown; charset=utf-8" }
};
export const ALLOWED_EXTENSIONS = Object.keys(EXTENSIONS);

const starts = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** True when the bytes really are the kind the extension claims. Pure; exported for tests. */
export function bytesMatch(kind: Kind, b: Uint8Array): boolean {
  switch (kind) {
    case "pdf": return starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "png": return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg": return starts(b, [0xff, 0xd8, 0xff]);
    case "gif": return starts(b, [0x47, 0x49, 0x46, 0x38]);
    case "webp": return starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8);
    case "zip": return starts(b, [0x50, 0x4b, 0x03, 0x04]);
    case "text": {
      if (b.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(b);
        return true;
      } catch {
        return false;
      }
    }
  }
}

/** Keeps a readable base name: no paths, control or quote characters; 120 characters at most. */
export function safeFilename(name: string): { name: string; ext: string } | null {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0 || dot === cleaned.length - 1) return null;
  const ext = cleaned.slice(dot + 1).toLowerCase();
  if (!EXTENSIONS[ext]) return null;
  const stem = cleaned.slice(0, dot).slice(0, 110);
  return { name: `${stem}.${ext}`, ext };
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

interface FileRow {
  id: string;
  contract_id: string;
  uploaded_by: string | null;
  party: Party;
  submission_id: string | null;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: string | number;
  sha256: string;
  status: string;
  created_at: Date;
}

export function fileOut(f: FileRow, viewerId: string) {
  return {
    id: f.id,
    filename: f.filename,
    content_type: f.content_type,
    size_bytes: Number(f.size_bytes),
    party: f.party,
    attached: Boolean(f.submission_id),
    submission_id: f.submission_id,
    mine: f.uploaded_by === viewerId,
    created_at: new Date(f.created_at).toISOString()
  };
}

async function sideOf(sql: Queryable, userId: string, contract: ContractRow): Promise<{ party: Party; canManage: boolean } | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  return org ? { party: "client", canManage: canManageOrganization(org.membership_role) } : null;
}

const notConfigured = (requestId: string) =>
  failure("FILES_NOT_CONFIGURED", "File uploads are not switched on yet. Share links in the delivery note for now.", 503, requestId);

export async function handleFileRoute(request: Request, env: Env, requestId: string, deps: FileRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const contractFiles = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/files$/);
  const download = path.match(/^\/api\/v1\/files\/([\w-]{1,64})$/);
  const remove = path.match(/^\/api\/v1\/files\/([\w-]{1,64})\/delete$/);
  const known =
    (method === "GET" && (contractFiles !== null || download !== null)) ||
    (method === "POST" && (contractFiles !== null || remove !== null));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  const bucket: R2BucketBinding | undefined = env.FILES;

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (download || remove) {
      const file = (await sql<FileRow[]>`SELECT * FROM contract_files WHERE id = ${(download ?? remove)![1]} AND status = 'ready' LIMIT 1`)[0];
      const contract = file ? (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${file.contract_id} LIMIT 1`)[0] : undefined;
      const side = contract ? await sideOf(sql, userId, contract) : null;
      let staff = false;
      if (!side && file && download) {
        const roles = await loadRoles(sql, userId);
        staff = roles.includes("admin") || roles.includes("moderator");
      }
      if (!file || !contract || (!side && !staff)) return failure("NOT_FOUND", "File not found", 404, requestId);
      if (!bucket) return notConfigured(requestId);

      if (remove) {
        if (file.uploaded_by !== userId) return failure("FORBIDDEN", "Only the person who uploaded a file can delete it.", 403, requestId);
        if (file.submission_id) return failure("FILE_IN_DELIVERY", "This file is part of a delivery and stays on the record.", 409, requestId);
        const rows = await sql<{ id: string }[]>`
          UPDATE contract_files SET status = 'deleted', deleted_at = now() WHERE id = ${file.id} AND status = 'ready' AND submission_id IS NULL RETURNING id
        `;
        if (!rows[0]) return failure("FILE_IN_DELIVERY", "This file is part of a delivery and stays on the record.", 409, requestId);
        await bucket.delete(file.r2_key);
        return success({ id: file.id }, "File deleted", 200, requestId);
      }

      const object = await bucket.get(file.r2_key);
      if (!object) return failure("NOT_FOUND", "File not found", 404, requestId);
      const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": file.content_type,
          "Content-Length": String(file.size_bytes),
          "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "private, no-store"
        }
      });
    }

    const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractFiles![1]} LIMIT 1`)[0];
    const side = contract ? await sideOf(sql, userId, contract) : null;
    if (!contract || !side) return failure("NOT_FOUND", "Contract not found", 404, requestId);

    if (method === "GET") {
      const rows = await sql<FileRow[]>`
        SELECT * FROM contract_files WHERE contract_id = ${contract.id} AND status = 'ready' ORDER BY created_at DESC LIMIT ${MAX_FILES_PER_CONTRACT}
      `;
      return success({ files: rows.map((f) => fileOut(f, userId)), uploads_enabled: Boolean(bucket), max_bytes: MAX_FILE_BYTES, allowed: ALLOWED_EXTENSIONS }, "Files", 200, requestId);
    }

    // upload
    if (!bucket) return notConfigured(requestId);
    if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins can add files for the client.", 403, requestId);
    if (contract.status !== "active") return failure("CONTRACT_NOT_ACTIVE", "Files can be added while the contract is active.", 409, requestId);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_FILE_BYTES + 64 * 1024) return failure("FILE_TOO_LARGE", "Files can be up to 10 MB.", 413, requestId);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return failure("INVALID_UPLOAD", "Send the file as multipart form data in the field \"file\".", 422, requestId);
    }
    const file = form.get("file");
    if (!file || typeof file === "string") return failure("INVALID_UPLOAD", "Choose a file to upload.", 422, requestId);
    const named = safeFilename(file.name);
    if (!named) return failure("FILE_TYPE_NOT_ALLOWED", `Allowed types: ${ALLOWED_EXTENSIONS.join(", ")}.`, 422, requestId);
    if (file.size <= 0) return failure("INVALID_UPLOAD", "The file is empty.", 422, requestId);
    if (file.size > MAX_FILE_BYTES) return failure("FILE_TOO_LARGE", "Files can be up to 10 MB.", 413, requestId);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const spec = EXTENSIONS[named.ext];
    if (!bytesMatch(spec.kind, bytes)) {
      return failure("FILE_TYPE_MISMATCH", `The file's content does not match .${named.ext}. Export it again or use another format.`, 422, requestId);
    }

    const usage = (await sql<{ n: number; bytes: string | number | null }[]>`
      SELECT count(*)::int AS n, COALESCE(sum(size_bytes), 0) AS bytes FROM contract_files WHERE contract_id = ${contract.id} AND status = 'ready'
    `)[0] ?? { n: 0, bytes: 0 };
    if (usage.n >= MAX_FILES_PER_CONTRACT) return failure("LIMIT_REACHED", `A contract can hold up to ${MAX_FILES_PER_CONTRACT} files.`, 429, requestId);
    if (Number(usage.bytes) + bytes.byteLength > MAX_BYTES_PER_CONTRACT) return failure("LIMIT_REACHED", "This contract has reached its 200 MB storage limit.", 429, requestId);

    const id = crypto.randomUUID();
    const key = `contracts/${contract.id}/${id}`;
    const digest = await sha256(buffer);
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: spec.type, contentDisposition: "attachment" },
      customMetadata: { contract_id: contract.id, uploaded_by: userId, sha256: digest }
    });
    let row: FileRow;
    try {
      row = (await sql<FileRow[]>`
        INSERT INTO contract_files (id, contract_id, uploaded_by, party, r2_key, filename, content_type, size_bytes, sha256, status, created_at)
        VALUES (${id}, ${contract.id}, ${userId}, ${side.party}, ${key}, ${named.name}, ${spec.type}, ${bytes.byteLength}, ${digest}, 'ready', now())
        RETURNING *
      `)[0];
    } catch (error) {
      await bucket.delete(key).catch(() => undefined);
      throw error;
    }
    await recordContractEvent(sql, contract.id, userId, side.party, "file.uploaded", { filename: named.name, size_bytes: bytes.byteLength });
    return success(fileOut(row, userId), "File uploaded", 201, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Attaches the caller's unattached files to a delivery. Inside the delivery transaction. */
export async function attachFilesToSubmission(tx: Queryable, contractId: string, userId: string, submissionId: string, fileIds: string[]): Promise<boolean> {
  if (!fileIds.length) return true;
  const rows = await tx<{ id: string }[]>`
    UPDATE contract_files SET submission_id = ${submissionId}
    WHERE id = ANY(${textArray(fileIds)}::text[]) AND contract_id = ${contractId} AND uploaded_by = ${userId} AND status = 'ready' AND submission_id IS NULL
    RETURNING id
  `;
  return rows.length === fileIds.length;
}

/** Ready files of a contract grouped by delivery; [] when the table does not exist yet. */
export async function filesBySubmission(sql: Queryable, contractId: string): Promise<Map<string, Array<{ id: string; filename: string; size_bytes: number }>>> {
  const map = new Map<string, Array<{ id: string; filename: string; size_bytes: number }>>();
  try {
    const rows = await sql<{ id: string; submission_id: string; filename: string; size_bytes: string | number }[]>`
      SELECT id, submission_id, filename, size_bytes FROM contract_files
      WHERE contract_id = ${contractId} AND status = 'ready' AND submission_id IS NOT NULL ORDER BY created_at ASC
    `;
    for (const r of rows) {
      const list = map.get(r.submission_id) ?? [];
      list.push({ id: r.id, filename: r.filename, size_bytes: Number(r.size_bytes) });
      map.set(r.submission_id, list);
    }
  } catch {
    // Migration 0065 not applied yet: deliveries simply have no files.
  }
  return map;
}
