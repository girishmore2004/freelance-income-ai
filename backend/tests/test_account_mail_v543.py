from app.services import account_mail


class FakeSMTP:
    calls = []

    def __init__(self, *args, **kwargs):
        self.calls.append(("init", args, kwargs))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def ehlo(self):
        self.calls.append(("ehlo",))

    def starttls(self, **kwargs):
        self.calls.append(("starttls", kwargs))

    def login(self, username, password):
        self.calls.append(("login", username, password))

    def send_message(self, message):
        self.calls.append(("send", message["To"], message["Subject"]))


def _configure(monkeypatch, ssl=False):
    monkeypatch.setattr(account_mail.settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(account_mail.settings, "smtp_port", 465 if ssl else 587)
    monkeypatch.setattr(account_mail.settings, "smtp_username", "smtp-user")
    monkeypatch.setattr(account_mail.settings, "smtp_password", "smtp-secret")
    monkeypatch.setattr(account_mail.settings, "smtp_from_email", "noreply@example.test")
    monkeypatch.setattr(account_mail.settings, "smtp_from_name", "Freelance Income AI")
    monkeypatch.setattr(account_mail.settings, "smtp_use_ssl", ssl)


def test_smtp_starttls_delivery_uses_provider_credentials_and_sender(monkeypatch):
    FakeSMTP.calls = []
    _configure(monkeypatch)
    monkeypatch.setattr(account_mail.smtplib, "SMTP", FakeSMTP)
    assert account_mail.send_account_email("user@example.test", "Verify", "Verify link") is True
    assert any(call[0] == "starttls" for call in FakeSMTP.calls)
    assert ("login", "smtp-user", "smtp-secret") in FakeSMTP.calls
    assert ("send", "user@example.test", "Verify") in FakeSMTP.calls


def test_smtp_implicit_tls_delivery_uses_ssl_transport(monkeypatch):
    FakeSMTP.calls = []
    _configure(monkeypatch, ssl=True)
    monkeypatch.setattr(account_mail.smtplib, "SMTP_SSL", FakeSMTP)
    assert account_mail.send_account_email("user@example.test", "Reset", "Reset link") is True
    assert FakeSMTP.calls[0][0] == "init"
    assert not any(call[0] == "starttls" for call in FakeSMTP.calls)


def test_mail_delivery_fails_closed_when_sender_is_not_configured(monkeypatch):
    monkeypatch.setattr(account_mail.settings, "smtp_host", "")
    monkeypatch.setattr(account_mail.settings, "smtp_from_email", "")
    assert account_mail.smtp_configured() is False
    try:
        account_mail.send_account_email("user@example.test", "Subject", "Body")
    except RuntimeError as exc:
        assert "not configured" in str(exc)
    else:
        raise AssertionError("Expected missing SMTP configuration to fail closed")
