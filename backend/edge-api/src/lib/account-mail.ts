export interface AccountMailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  APP_NAME?: string;
}

export interface AccountEmail {
  to: string;
  subject: string;
  text: string;
}

export interface AccountMailResult {
  accepted: boolean;
  provider: "resend";
  messageId?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing email configuration: ${name}`);
  }
  return normalized;
}

function validateEmail(email: string): void {
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Invalid recipient email address.");
  }
}

export function accountMailConfigured(env: AccountMailEnv): boolean {
  return Boolean(
    env.RESEND_API_KEY?.trim() &&
    env.RESEND_FROM_EMAIL?.trim(),
  );
}

/**
 * Sends a transactional account email through Resend.
 *
 * Important:
 * - This function never logs API keys or message contents.
 * - A non-2xx provider response is treated as a delivery failure.
 * - "accepted" means Resend accepted the request, not that the
 *   recipient's mailbox has received or displayed the email.
 */
export async function sendAccountEmail(
  env: AccountMailEnv,
  message: AccountEmail,
): Promise<AccountMailResult> {
  const apiKey = requiredValue(env.RESEND_API_KEY, "RESEND_API_KEY");
  const from = requiredValue(env.RESEND_FROM_EMAIL, "RESEND_FROM_EMAIL");

  validateEmail(message.to);

  if (!message.subject.trim() || message.subject.length > 200) {
    throw new Error("Invalid email subject.");
  }

  if (!message.text.trim() || message.text.length > 20_000) {
    throw new Error("Invalid email message body.");
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });

  const responseBody = await response.json().catch(() => null) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!response.ok) {
    // Do not include credentials or the full request body in errors.
    const providerMessage =
      typeof responseBody?.message === "string"
        ? responseBody.message.slice(0, 300)
        : "Email provider rejected the request.";

    throw new Error(
      `Account email delivery failed (${response.status}): ${providerMessage}`,
    );
  }

  if (!responseBody?.id) {
    throw new Error("Email provider returned no message ID.");
  }

  return {
    accepted: true,
    provider: "resend",
    messageId: responseBody.id,
  };
}
