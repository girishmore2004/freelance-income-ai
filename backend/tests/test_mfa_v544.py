from pathlib import Path

from app.services.mfa import (
    decrypt_totp_secret, encrypt_totp_secret, generate_recovery_codes,
    generate_totp_secret, normalize_recovery_code, provisioning_uri,
    recovery_code_hash, totp_code, verify_totp, matching_totp_step,
)


def test_totp_matches_rfc_6238_sha1_six_digit_test_vector():
    # RFC 6238 SHA-1 secret "12345678901234567890", timestamp 59.
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp_code(secret, timestamp=59) == "287082"
    assert verify_totp(secret, "287082", timestamp=59, window=0)
    assert matching_totp_step(secret, "287082", timestamp=59, window=0) == 1
    assert not verify_totp(secret, "000000", timestamp=59, window=0)
    assert not verify_totp(secret, "abc287082", timestamp=59, window=0)


def test_totp_generated_secret_is_valid_and_uri_is_authenticator_compatible():
    secret = generate_totp_secret()
    assert len(secret) >= 32
    code = totp_code(secret, timestamp=1_700_000_000)
    assert verify_totp(secret, code, timestamp=1_700_000_000)
    uri = provisioning_uri(secret, "person@example.com")
    assert uri.startswith("otpauth://totp/")
    assert "secret=" in uri and "issuer=Freelance%20Income%20AI" in uri


def test_mfa_secret_is_encrypted_and_decrypts_only_with_same_signing_secret():
    secret = generate_totp_secret()
    encrypted = encrypt_totp_secret(secret, "strong-secret-A")
    assert encrypted != secret
    assert decrypt_totp_secret(encrypted, "strong-secret-A") == secret
    try:
        decrypt_totp_secret(encrypted, "different-secret-B")
    except ValueError:
        pass
    else:
        raise AssertionError("A changed application secret must not decrypt the TOTP secret")


def test_recovery_codes_are_random_and_normalized_hashes_are_stable():
    codes = generate_recovery_codes()
    assert len(codes) == 10
    assert len(set(codes)) == 10
    assert normalize_recovery_code(codes[0]) == codes[0].replace("-", "")
    assert recovery_code_hash(codes[0]) == recovery_code_hash(codes[0].upper())
    assert recovery_code_hash(codes[0]) != recovery_code_hash(codes[1])
    assert recovery_code_hash("☃") == recovery_code_hash("")


def test_mfa_routes_and_login_lockout_are_present_and_protected_by_auth_rate_limit():
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()
    for route in (
        '@app.post("/api/v1/auth/mfa/verify-login")',
        '@app.post("/api/v1/auth/mfa/setup")',
        '@app.post("/api/v1/auth/mfa/enable")',
        '@app.post("/api/v1/auth/mfa/disable")',
        '@app.post("/api/v1/auth/mfa/recovery-codes/rotate")',
        '@app.get("/api/v1/auth/mfa/status")',
        '@app.post("/api/v1/auth/mfa/recovery-codes/rotate")',
    ):
        assert route in main
    assert "settings.login_failure_limit" in main
    assert "settings.login_lockout_minutes" in main
    assert "settings.mfa_challenge_max_attempts" in main
    assert "user.mfa_last_used_step" in main
    assert "AuthSession.revoked_at" in main
    assert "MFAChallenge.used_at" in main
    assert "timedelta(days=7)" in main
    limiter = (root / "app" / "services" / "rate_limit.py").read_text()
    assert 'path.startswith("/api/v1/auth/")' in limiter


def test_v544_migration_extends_v543_and_creates_mfa_tables():
    root = Path(__file__).parents[1]
    migration = (root / "alembic" / "versions" / "0045_mfa_and_login_lockout.py").read_text()
    assert 'revision = "0045_mfa_and_login_lockout"' in migration
    assert 'down_revision = "0044_account_security"' in migration
    assert '"mfa_recovery_codes"' in migration
    assert '"mfa_challenges"' in migration
    assert '"locked_until"' in migration
    assert '"mfa_last_used_step"' in migration
