import type { Env } from "../types";

/**
 * Transactional account email (verification, password reset) for the Edge API.
 *
 * Cloudflare Workers cannot use the Python service's SMTP client, so the Edge
 * API supports the Resend HTTP API only. Configure:
 *   EMAIL_PROVIDER=resend           (plain variable)
 *   RESEND_FROM_EMAIL=no-reply@...  (plain variable; a domain verified in Resend)
 *   RESEND_FROM_NAME=...            (optional plain variable)
 *   RESEND_API_KEY                  (Cloudflare secret)
 *
 * The message body is plain text; links are never logged.
 */

export class MailNotConfiguredError extends Error {
  readonly code = "EMAIL_DELIVERY_NOT_CONFIGURED";
}

export class MailDeliveryError extends Error {
  readonly code = "EMAIL_DELIVERY_FAILED";
}

export function accountMailConfigured(env: Env): boolean {
  return (
    String(env.EMAIL_PROVIDER ?? "").trim().toLowerCase() === "resend" &&
    Boolean(String(env.RESEND_API_KEY ?? "").trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(env.RESEND_FROM_EMAIL ?? "").trim())
  );
}

/** Base URL used in emailed links; must be the frontend, never the API. */
export function publicAppUrl(env: Env): string {
  const configured = String(env.PUBLIC_APP_URL ?? env.FRONTEND_URL ?? "").trim();
  const fallback = String(env.CORS_ORIGINS ?? "").split(",")[0]?.trim() ?? "";
  const url = (configured || fallback).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) {
    throw new MailNotConfiguredError("PUBLIC_APP_URL (the frontend URL) is required for account emails");
  }
  return url;
}

export interface AccountEmail {
  to: string;
  subject: string;
  text: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function sendAccountEmail(env: Env, message: AccountEmail, fetchImpl: FetchLike = fetch): Promise<{ id: string }> {
  if (!accountMailConfigured(env)) {
    throw new MailNotConfiguredError("Account email delivery is not configured");
  }
  const fromEmail = String(env.RESEND_FROM_EMAIL).trim();
  const fromName = String(env.RESEND_FROM_NAME ?? env.APP_NAME ?? "Freelance Income AI").replace(/[<>"\r\n]/g, "").trim();
  const base = String(env.RESEND_API_BASE_URL ?? "https://api.resend.com").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new MailNotConfiguredError("RESEND_API_BASE_URL must use https");

  const response = await fetchImpl(`${base}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      to: [message.to],
      subject: message.subject.slice(0, 200),
      text: message.text
    })
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok || !data.id) {
    // Provider message only; never include the email body (it contains the link).
    throw new MailDeliveryError(`Resend rejected the message (HTTP ${response.status}${data.message ? `: ${String(data.message).slice(0, 120)}` : ""})`);
  }
  return { id: data.id };
}
