import postgres from "postgres";
import type { Env } from "../types";
import { hashPassword } from "./password-service";
import { createAccessSession } from "./session-service";
import { failure, success } from "./response";
import { issueAccountActionTokenWith } from "./account-token-store";
import { FLAGS, isEnabled } from "./flags";
import { accountMailConfigured, publicAppUrl, sendAccountEmail } from "./account-mailer";

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
      application_name: "Freelance Income AI Edge API - Register"
    }
  });
}

function validate(
  body: unknown
): { email: string; password: string; intent: "freelancer" | "client" | "both"; fullName: string } | null {
  if (!body || typeof body !== "object") return null;

  const { email, password, intent, full_name: fullNameRaw } = body as Record<string, unknown>;

  // U29: the person's name (optional for older clients; the app asks for it). 2–100 characters.
  let fullName = "";
  if (fullNameRaw !== undefined && fullNameRaw !== null && fullNameRaw !== "") {
    if (typeof fullNameRaw !== "string") return null;
    fullName = fullNameRaw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
    if (fullName.length < 2 || fullName.length > 100) return null;
  }

  // Optional: which public role(s) to start with (Master Plan: "Find work" / "Hire" / both).
  if (intent !== undefined && intent !== "freelancer" && intent !== "client" && intent !== "both") {
    return null;
  }

  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();

  if (
    normalized.length < 5 ||
    normalized.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return null;
  }

  // Same limits as the original FastAPI RegisterIn schema.
  if (password.length < 12 || password.length > 128) return null;

  return { email: normalized, password, intent: intent === "client" || intent === "both" ? intent : "freelancer", fullName };
}

/**
 * POST /api/v1/auth/register
 * Port of the FastAPI register route, including the email-verification flow
 * (REQUIRE_EMAIL_VERIFICATION=true sends a single-use link through Resend).
 * Returns null when the request is not a register request.
 */
export async function handleRegisterRoute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    url.pathname !== "/api/v1/auth/register" ||
    request.method.toUpperCase() !== "POST"
  ) {
    return null;
  }

  if (env.PUBLIC_REGISTRATION?.trim().toLowerCase() !== "true") {
    return failure(
      "REGISTRATION_DISABLED",
      "Public registration is disabled",
      403,
      requestId
    );
  }

  const requireVerification =
    env.REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase() === "true";

  if (requireVerification && !accountMailConfigured(env)) {
    return failure(
      "EMAIL_DELIVERY_NOT_CONFIGURED",
      "Account email delivery is not configured. Contact the administrator.",
      503,
      requestId
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failure(
      "INVALID_REQUEST_BODY",
      "A valid JSON request body is required.",
      400,
      requestId
    );
  }

  const input = validate(body);

  if (!input) {
    return failure(
      "INVALID_REGISTER_INPUT",
      "Provide a valid email, a password of 12 to 128 characters and, optionally, your name (2–100 characters) and intent \"freelancer\", \"client\" or \"both\".",
      422,
      requestId
    );
  }

  const sql = database(env);

  if (input.intent !== "freelancer" && !(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
    await sql.end({ timeout: 5 });
    return failure(
      "FEATURE_DISABLED",
      "Hiring accounts are not open yet. Register to find work, or try again when the client marketplace launches.",
      403,
      requestId
    );
  }

  try {
    const passwordHash = await hashPassword(input.password);
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();

    const created = await sql.begin(async (tx) => {
      const existing = await tx`
        SELECT id FROM users WHERE email = ${input.email} LIMIT 1
      `;

      if (existing.length > 0) return false;

      await tx`
        INSERT INTO users (
          id, email, password_hash, created_at, email_verified,
          mfa_enabled, mfa_secret_encrypted, failed_login_attempts
        ) VALUES (
          ${userId}, ${input.email}, ${passwordHash}, now(), ${!requireVerification},
          false, '', 0
        )
      `;

      await tx`
        INSERT INTO profiles (
          id, user_id, full_name, headline, bio, skills, services,
          portfolio_links, minimum_budget, currency, weekly_hours,
          hourly_rate, timezone, preferred_work_types,
          preferred_industries, dealbreakers
        ) VALUES (
          ${profileId}, ${userId}, ${input.fullName}, '', '', '[]', '[]',
          '[]', 5000, 'INR', 10,
          0, 'Asia/Kolkata', '["fixed", "hourly"]',
          '[]', '[]'
        )
      `;

      // Public role(s) chosen at sign-up (migration 0050): the workspace shows only
      // these sides. The other role can be activated later from the account page.
      for (const role of input.intent === "both" ? (["freelancer", "client"] as const) : [input.intent]) {
        await tx`
          INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${userId}, ${role}, 'active', 'self', now(), now())
        `;
      }

      if (requireVerification) {
        // Issued and emailed inside the transaction: if the provider rejects
        // the message, the account is not created (same as the Python route).
        const issued = await issueAccountActionTokenWith(tx, userId, "verify_email");
        const link = `${publicAppUrl(env)}/#verify_token=${issued.token}`;
        await sendAccountEmail(env, {
          to: input.email,
          subject: "Verify your Freelance Income AI account",
          text: `Welcome! Verify your email address using this link (valid for 24 hours):\n\n${link}\n\nIf you did not create this account, ignore this message.`
        });
      }

      return true;
    });

    if (!created) {
      // Do not reveal whether the address is already registered.
      return success(
        {
          status: "verification_required",
          message:
            "If the address can be registered, a verification email will be sent."
        },
        "Request received",
        200,
        requestId
      );
    }

    if (requireVerification) {
      return success(
        {
          status: "verification_required",
          message: "Account created. Check your email for the verification link."
        },
        "Account created. Check your email for the verification link.",
        201,
        requestId
      );
    }

    const session = await createAccessSession(env, userId);

    return success(
      {
        status: "authenticated",
        access_token: session.accessToken,
        token_type: session.tokenType,
        expires_at: session.expiresAt
      },
      "Account created",
      201,
      requestId
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "auth.register_failed",
        request_id: requestId,
        error_type: error instanceof Error ? error.name : "UnknownError",
        error_message: error instanceof Error ? error.message : "unknown"
      })
    );

    return failure(
      "REGISTER_TEMPORARILY_UNAVAILABLE",
      "Unable to create the account right now. Please try again later.",
      503,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
