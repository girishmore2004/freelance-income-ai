"""TOTP MFA primitives with authenticated encryption and one-time recovery codes."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken


def _fernet(secret_key: str) -> Fernet:
    # Derive a purpose-specific key; never reuse the JWT signing key directly.
    material = hashlib.sha256(("freelance-income-ai:mfa:v1:" + secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(material))


def encrypt_totp_secret(secret: str, secret_key: str) -> str:
    return _fernet(secret_key).encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_totp_secret(ciphertext: str, secret_key: str) -> str:
    try:
        return _fernet(secret_key).decrypt(ciphertext.encode("ascii")).decode("ascii")
    except (InvalidToken, ValueError, UnicodeError):
        raise ValueError("Unable to decrypt MFA secret; verify SECRET_KEY has not changed.")


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_code(secret: str, timestamp: int | None = None, period: int = 30) -> str:
    timestamp = int(time.time()) if timestamp is None else int(timestamp)
    counter = timestamp // period
    key = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{binary % 1_000_000:06d}"


def matching_totp_step(secret: str, code: str, timestamp: int | None = None,
                        window: int = 1) -> int | None:
    candidate = str(code)
    if len(candidate) != 6 or not candidate.isdigit():
        return None
    now = int(time.time()) if timestamp is None else int(timestamp)
    current_step = now // 30
    for offset in range(-window, window + 1):
        step = current_step + offset
        expected = totp_code(secret, timestamp=step * 30)
        if hmac.compare_digest(expected, candidate):
            return step
    return None


def verify_totp(secret: str, code: str, timestamp: int | None = None, window: int = 1) -> bool:
    return matching_totp_step(secret, code, timestamp, window) is not None


def provisioning_uri(secret: str, email: str, issuer: str = "Freelance Income AI") -> str:
    label = quote(f"{issuer}:{email}", safe="")
    return (f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer, safe='')}"
            "&algorithm=SHA1&digits=6&period=30")


def generate_recovery_codes(count: int = 10) -> list[str]:
    return [f"{secrets.token_hex(4)}-{secrets.token_hex(4)}" for _ in range(count)]


def normalize_recovery_code(code: str) -> str:
    # Recovery codes are generated from ASCII hex; reject/strip all non-ASCII
    # input so malformed Unicode cannot raise during digest calculation.
    return re.sub(r"[^a-z0-9]", "", str(code).lower())


def recovery_code_hash(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode("ascii")).hexdigest()
