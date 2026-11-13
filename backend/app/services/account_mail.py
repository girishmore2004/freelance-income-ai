
"""Transactional email delivery using SMTP or the Resend HTTP API."""

from email.message import EmailMessage
import logging
import smtplib
import ssl

import httpx

from ..core import settings

logger = logging.getLogger(__name__)


def _email_provider() -> str:
    return str(getattr(settings, "email_provider", "smtp") or "smtp").strip().lower()


def _resend_configured() -> bool:
    return bool(
        getattr(settings, "resend_api_key", "").strip()
        and getattr(settings, "resend_from_email", "").strip()
    )


def _smtp_configured() -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_port
        and settings.smtp_from_email
    )


def smtp_configured() -> bool:
    """
    Backward-compatible function name used by existing authentication routes.

    It now reports whether the selected transactional email provider is
    configured, not only whether SMTP is configured.
    """
    provider = _email_provider()

    if provider == "resend":
        return _resend_configured()

    if provider == "smtp":
        return _smtp_configured()

    return False


def _send_with_resend(
    recipient: str,
    subject: str,
    text_body: str,
) -> bool:
    if not _resend_configured():
        raise RuntimeError(
            "Resend email is not configured. Set RESEND_API_KEY "
            "and RESEND_FROM_EMAIL."
        )

    base_url = (
        getattr(settings, "resend_api_base_url", "https://api.resend.com")
        .strip()
        .rstrip("/")
    )

    if not base_url.startswith("https://"):
        raise RuntimeError("RESEND_API_BASE_URL must use HTTPS.")

    sender_name = (
        getattr(settings, "resend_from_name", "")
        or settings.smtp_from_name
        or "Freelance Income AI"
    ).strip()

    sender_email = settings.resend_from_email.strip()
    sender = f"{sender_name} <{sender_email}>"

    payload = {
        "from": sender,
        "to": [recipient],
        "subject": subject,
        "text": text_body,
    }

    headers = {
        "Authorization": f"Bearer {settings.resend_api_key.strip()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        response = httpx.post(
            f"{base_url}/emails",
            json=payload,
            headers=headers,
            timeout=httpx.Timeout(15.0, connect=5.0),
        )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        logger.warning("Resend email request timed out.")
        raise RuntimeError("Transactional email provider timed out.") from exc
    except httpx.HTTPStatusError as exc:
        # Do not log request headers or API keys.
        status_code = exc.response.status_code
        logger.error(
            "Resend rejected an email request with HTTP status %s.",
            status_code,
        )
        raise RuntimeError(
            f"Transactional email provider rejected the request "
            f"(HTTP {status_code})."
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("Resend email provider could not be reached.")
        raise RuntimeError(
            "Transactional email provider is temporarily unavailable."
        ) from exc

    return True


def _send_with_smtp(
    recipient: str,
    subject: str,
    text_body: str,
) -> bool:
    if not _smtp_configured():
        raise RuntimeError(
            "SMTP email is not configured. Set SMTP_HOST, SMTP_PORT "
            "and SMTP_FROM_EMAIL."
        )

    message = EmailMessage()
    message["From"] = (
        f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    )
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text_body)

    context = ssl.create_default_context()

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=15,
            context=context,
        ) as server:
            if settings.smtp_username:
                server.login(
                    settings.smtp_username,
                    settings.smtp_password,
                )
            server.send_message(message)
    else:
        with smtplib.SMTP(
            settings.smtp_host,
            settings.smtp_port,
            timeout=15,
        ) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()

            if settings.smtp_username:
                server.login(
                    settings.smtp_username,
                    settings.smtp_password,
                )

            server.send_message(message)

    return True


def send_account_email(
    recipient: str,
    subject: str,
    text_body: str,
) -> bool:
    """
    Send account verification and password recovery messages.

    The existing application calls this function directly. The public
    function signature is intentionally unchanged.
    """
    if not recipient or not subject or not text_body:
        raise ValueError(
            "Recipient, subject and message body are required."
        )

    provider = _email_provider()

    if provider == "resend":
        return _send_with_resend(recipient, subject, text_body)

    if provider == "smtp":
        return _send_with_smtp(recipient, subject, text_body)

    raise RuntimeError(
        "EMAIL_PROVIDER must be either 'smtp' or 'resend'."
    )
