
from app.services import account_mail


class FakeResponse:
    status_code = 200

    def raise_for_status(self):
        return None


def test_resend_delivery_sends_expected_payload(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        account_mail.settings,
        "email_provider",
        "resend",
    )
    monkeypatch.setattr(
        account_mail.settings,
        "resend_api_key",
        "re_test_key",
    )
    monkeypatch.setattr(
        account_mail.settings,
        "resend_from_email",
        "noreply@example.test",
    )
    monkeypatch.setattr(
        account_mail.settings,
        "resend_from_name",
        "Freelance Income AI",
    )
    monkeypatch.setattr(
        account_mail.settings,
        "resend_api_base_url",
        "https://api.resend.com",
    )

    def fake_post(url, json, headers, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(account_mail.httpx, "post", fake_post)

    assert account_mail.smtp_configured() is True
    assert account_mail.send_account_email(
        "user@example.test",
        "Verify your account",
        "Your verification link",
    ) is True

    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["json"]["to"] == ["user@example.test"]
    assert captured["json"]["subject"] == "Verify your account"
    assert captured["json"]["text"] == "Your verification link"
    assert captured["headers"]["Authorization"] == "Bearer re_test_key"


def test_resend_provider_fails_when_api_key_is_missing(monkeypatch):
    monkeypatch.setattr(
        account_mail.settings,
        "email_provider",
        "resend",
    )
    monkeypatch.setattr(
        account_mail.settings,
        "resend_api_key",
        "",
    )
    monkeypatch.setattr(
        account_mail.settings,
        "resend_from_email",
        "noreply@example.test",
    )

    assert account_mail.smtp_configured() is False

    try:
        account_mail.send_account_email(
            "user@example.test",
            "Subject",
            "Body",
        )
    except RuntimeError as exc:
        assert "not configured" in str(exc)
    else:
        raise AssertionError("Expected missing Resend configuration to fail closed")


def test_unknown_email_provider_is_rejected(monkeypatch):
    monkeypatch.setattr(
        account_mail.settings,
        "email_provider",
        "unknown",
    )

    assert account_mail.smtp_configured() is False

    try:
        account_mail.send_account_email(
            "user@example.test",
            "Subject",
            "Body",
        )
    except RuntimeError as exc:
        assert "EMAIL_PROVIDER" in str(exc)
    else:
        raise AssertionError("Expected unknown provider to be rejected")
