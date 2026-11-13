"""Transactional email delivery for account verification and password recovery."""
from email.message import EmailMessage
import smtplib
import ssl
from ..core import settings


def smtp_configured() -> bool:
    return all((settings.smtp_host, settings.smtp_port, settings.smtp_from_email))


def send_account_email(recipient: str, subject: str, text_body: str) -> bool:
    if not smtp_configured():
        raise RuntimeError("Transactional email is not configured. Set SMTP_HOST, SMTP_PORT and SMTP_FROM_EMAIL.")
    message = EmailMessage()
    message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text_body)
    context = ssl.create_default_context()
    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=context) as server:
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
    return True
