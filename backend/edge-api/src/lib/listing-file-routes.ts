import type { Env, R2BucketBinding } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { tableExists } from "./external-pipeline";
import { ALLOWED_EXTENSIONS, MAX_FILE_BYTES, attachmentResponse, readUpload, sha256 } from "./file-routes";

/**
 * Reference files on a project brief (U10; posting wizard step 7), in R2.
 *
 *   GET  /api/v1/listings/{id}/files                 organisation members
 *   POST /api/v1/listings/{id}/files                 owners/admins; while the project is not closed
 *   POST /api/v1/listing-files/{id}/delete           owners/admins
 *   GET  /api/v1/marketplace/listings/{id}/files     freelancers who can see the project (signed in)
 *   GET  /api/v1/listing-files/{id}                  download: members, freelancers who can see it, staff
 *
 * Confidential briefs share files only with invited freelancers and those who
 * already proposed. Same checks as contract files: allow-listed types checked
 * against the bytes, 10 MB per file, 10 files and 25 MB per project, always
 * downloaded as attachments. Visitors (not signed in) never get files.
 */

export interface ListingFileRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: ListingFileRouteDeps = { database, authenticate: authenticateRequest };

export const MAX_LISTING_FILES = 10;
export const MAX_LISTING_BYTES = 25 * 1024 * 1024;
const CLOSED = ["closed", "cancelled", "expired"];

type ListingRow = { id: string; organization_id: string; status: string; visibility: string; closes_at: Date | null; confidentiality: string; org_status: string };
type FileRow = { id: string; listing_id: string; uploaded_by: string | null; r2_key: string; filename: string; content_type: string; size_bytes: string | number; created_at: Date };

export type ListingAccess = { member: boolean; canManage: boolean; canView: boolean };

/**
 * Who may see a listing's files. Pure, exported for tests.
 * Non-members need a live, visible project; confidential briefs also need an invitation or an existing proposal.
 */
export function listingFileAccess(
  listing: { status: string; visibility: string; closes_at: Date | string | null; confidentiality: string; org_status: string },
  viewer: { membershipRole: string | null; invited: boolean; proposed: boolean },
  now: Date
): ListingAccess {
  if (viewer.membershipRole) return { member: true, canManage: canManageOrganization(viewer.membershipRole), canView: true };
  const live = ["published", "hiring"].includes(listing.status) && listing.org_status === "active"
    && (listing.closes_at === null || new Date(listing.closes_at).getTime() > now.getTime());
  const visible = listing.visibility === "public" || viewer.invited || viewer.proposed;
  const confidentialOk = listing.confidentiality !== "confidential" || viewer.invited || viewer.proposed;
  return { member: false, canManage: false, canView: (live || viewer.proposed) && visible && confidentialOk };
}

async function access(sql: Queryable, listingId: string, userId: string, now: Date): Promise<{ listing: ListingRow; access: ListingAccess } | null> {
  const listing = (await sql<ListingRow[]>`
    SELECT l.id, l.organization_id, l.status, l.visibility, l.closes_at, v.confidentiality, o.status AS org_status
    FROM project_listings l
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = ${listingId} LIMIT 1
  `)[0];
  if (!listing) return null;
  const org = await organizationForMember(sql, userId, listing.organization_id);
  const flags = (await sql<Array<{ invited: boolean; proposed: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM listing_invitations i WHERE i.listing_id = ${listingId} AND i.freelancer_user_id = ${userId} AND i.status IN ('pending', 'accepted')) AS invited,
           EXISTS (SELECT 1 FROM listing_proposals p WHERE p.listing_id = ${listingId} AND p.freelancer_user_id = ${userId} AND p.status <> 'withdrawn') AS proposed
  `)[0] ?? { invited: false, proposed: false };
  return { listing, access: listingFileAccess(listing, { membershipRole: org?.membership_role ?? null, invited: Boolean(flags.invited), proposed: Boolean(flags.proposed) }, now) };
}

const out = (f: FileRow, viewerId: string) => ({
  id: f.id, filename: f.filename, content_type: f.content_type, size_bytes: Number(f.size_bytes),
  mine: f.uploaded_by === viewerId, created_at: new Date(f.created_at).toISOString()
});

export async function handleListingFileRoute(request: Request, env: Env, requestId: string, deps: ListingFileRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const own = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/files$/);
  const market = path.match(/^\/api\/v1\/marketplace\/listings\/([\w-]{1,64})\/files$/);
  const download = path.match(/^\/api\/v1\/listing-files\/([\w-]{1,64})$/);
  const remove = path.match(/^\/api\/v1\/listing-files\/([\w-]{1,64})\/delete$/);
  const known =
    (method === "GET" && (own !== null || market !== null || download !== null)) ||
    (method === "POST" && (own !== null || remove !== null));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  const bucket: R2BucketBinding | undefined = env.FILES;
  const now = new Date();

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    if (!(await tableExists(sql, "listing_files"))) {
      if (method === "GET" && (own || market)) return success({ files: [], uploads_enabled: false, max_bytes: MAX_FILE_BYTES, allowed: ALLOWED_EXTENSIONS }, "Files", 200, requestId);
      return failure("MIGRATION_PENDING", "Project files need database migration 0071.", 503, requestId);
    }

    if (download || remove) {
      const file = (await sql<FileRow[]>`SELECT * FROM listing_files WHERE id = ${(download ?? remove)![1]} AND status = 'ready' LIMIT 1`)[0];
      const found = file ? await access(sql, file.listing_id, userId, now) : null;
      let staff = false;
      if (file && found && !found.access.canView && download) {
        const roles = await loadRoles(sql, userId);
        staff = roles.includes("admin") || roles.includes("moderator");
      }
      if (!file || !found || (!found.access.canView && !staff)) return failure("NOT_FOUND", "File not found", 404, requestId);
      if (remove) {
        if (!found.access.canManage) return failure("FORBIDDEN", "Only owners and admins of the client account remove project files.", 403, requestId);
        const rows = await sql<{ id: string }[]>`UPDATE listing_files SET status = 'deleted', deleted_at = now() WHERE id = ${file.id} AND status = 'ready' RETURNING id`;
        if (rows[0] && bucket) await bucket.delete(file.r2_key).catch(() => undefined);
        return success({ id: file.id }, "File removed", 200, requestId);
      }
      if (!bucket) return failure("FILES_NOT_CONFIGURED", "File storage is not switched on yet.", 503, requestId);
      const object = await bucket.get(file.r2_key);
      if (!object) return failure("NOT_FOUND", "File not found", 404, requestId);
      return attachmentResponse(object.body, file);
    }

    const listingId = (own ?? market)![1];
    const found = await access(sql, listingId, userId, now);
    if (!found || !found.access.canView || (own && !found.access.member)) return failure("NOT_FOUND", "Project not found", 404, requestId);

    if (method === "GET") {
      const rows = await sql<FileRow[]>`SELECT * FROM listing_files WHERE listing_id = ${listingId} AND status = 'ready' ORDER BY created_at ASC LIMIT ${MAX_LISTING_FILES}`;
      return success(
        { files: rows.map((f) => out(f, userId)), uploads_enabled: Boolean(bucket) && found.access.canManage, can_manage: found.access.canManage, max_bytes: MAX_FILE_BYTES, allowed: ALLOWED_EXTENSIONS },
        "Files",
        200,
        requestId
      );
    }

    // upload
    if (!found.access.canManage) return failure("FORBIDDEN", "Only owners and admins of the client account add project files.", 403, requestId);
    if (CLOSED.includes(found.listing.status)) return failure("LISTING_CLOSED", "This project is closed. Files can no longer be added.", 409, requestId);
    if (!bucket) return failure("FILES_NOT_CONFIGURED", "File uploads are not switched on yet. Put links in the brief for now.", 503, requestId);
    const upload = await readUpload(request, MAX_FILE_BYTES);
    if (!upload.ok) return failure(upload.code, upload.message, upload.status, requestId);
    const usage = (await sql<{ n: number; bytes: string | number }[]>`
      SELECT count(*)::int AS n, COALESCE(sum(size_bytes), 0) AS bytes FROM listing_files WHERE listing_id = ${listingId} AND status = 'ready'
    `)[0] ?? { n: 0, bytes: 0 };
    if (usage.n >= MAX_LISTING_FILES) return failure("LIMIT_REACHED", `A project can hold up to ${MAX_LISTING_FILES} files.`, 429, requestId);
    if (Number(usage.bytes) + upload.bytes.byteLength > MAX_LISTING_BYTES) return failure("LIMIT_REACHED", "This project has reached its 25 MB file limit.", 429, requestId);

    const id = crypto.randomUUID();
    const key = `listings/${listingId}/${id}`;
    const digest = await sha256(upload.buffer);
    await bucket.put(key, upload.bytes, {
      httpMetadata: { contentType: upload.type, contentDisposition: "attachment" },
      customMetadata: { listing_id: listingId, uploaded_by: userId, sha256: digest }
    });
    try {
      const row = (await sql<FileRow[]>`
        INSERT INTO listing_files (id, listing_id, uploaded_by, r2_key, filename, content_type, size_bytes, sha256, status, created_at)
        VALUES (${id}, ${listingId}, ${userId}, ${key}, ${upload.name}, ${upload.type}, ${upload.bytes.byteLength}, ${digest}, 'ready', now())
        RETURNING *
      `)[0];
      return success(out(row, userId), "File added to the project", 201, requestId);
    } catch (error) {
      await bucket.delete(key).catch(() => undefined);
      throw error;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
