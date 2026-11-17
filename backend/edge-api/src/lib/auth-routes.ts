
import postgres from "postgres";
import type { Env } from "../types";
import { revokeAccessSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { failure, success } from "./response";
import { loadRoles } from "./identity";

function database(env: Env) {
  const connectionString = env.HYPERDRIVE?.connectionString;

  if (!connectionString) {
    throw new Error("Hyperdrive database connection is not configured.");
  }

  return postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: {
      application_name: "Freelance Income AI Edge API - Auth Routes"
    }
  });
}

// Bearer or HttpOnly cookie (with CSRF check); see auth-context.ts.
async function requireUser(
  request: Request,
  env: Env,
  requestId: string
) {
  const authenticated = await authenticateRequest(request, env, requestId);

  if (authenticated instanceof Response) {
    return { response: authenticated };
  }

  return { authenticated };
}

export async function handleAuthRoute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/v1/me") {
    const result = await requireUser(request, env, requestId);

    if (result.response) return result.response;

    const user = result.authenticated!.user;

    const sql = database(env);
    let roles: string[];
    try {
      roles = await loadRoles(sql, user.id);
    } finally {
      await sql.end({ timeout: 5 });
    }

    return success(
      {
        id: user.id,
        email: user.email,
        email_verified: user.email_verified,
        roles
      },
      "Current user retrieved",
      200,
      requestId
    );
  }

  if (method === "POST" && path === "/api/v1/auth/logout") {
    const result = await requireUser(request, env, requestId);

    if (result.response) return result.response;

    const { user, claims } = result.authenticated!;

    await revokeAccessSession(
      env,
      user.id,
      claims.jti
    );

    return success(
      { status: "logged_out" },
      "Logged out successfully",
      200,
      requestId
    );
  }

  if (method === "POST" && path === "/api/v1/auth/logout-all") {
    const result = await requireUser(request, env, requestId);

    if (result.response) return result.response;

    const user = result.authenticated!.user;

    const sql = database(env);

    try {
      await sql.begin(async (tx) => {
        await tx`
          UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE
            user_id = ${user.id}
            AND revoked_at IS NULL
        `;

        await tx`
          UPDATE mfa_challenges
          SET used_at = NOW()
          WHERE
            user_id = ${user.id}
            AND used_at IS NULL
        `;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }

    return success(
      { status: "all_sessions_revoked" },
      "All sessions have been revoked",
      200,
      requestId
    );
  }

  return null;
}
