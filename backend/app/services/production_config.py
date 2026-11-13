"""Production configuration checks that never echo secret values."""
from urllib.parse import urlparse


def _is_https_origin(value):
    parsed = urlparse(str(value or ""))
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.netloc
        and "*" not in parsed.netloc
        and parsed.path == ""
        and not parsed.query
        and not parsed.fragment
        and not parsed.username
        and not parsed.password
    )


def validate_production_settings(settings):
    errors = []
    warnings = []

    secret = str(getattr(settings, "secret_key", "") or "")
    if secret == "unsafe-development-secret-change-me" or len(secret) < 32 or len(set(secret)) < 12:
        errors.append("SECRET_KEY must be a unique random value of at least 32 characters.")
    diagnostics_key = str(getattr(settings, "diagnostics_api_key", "") or "")
    if diagnostics_key and (len(diagnostics_key) < 32 or len(set(diagnostics_key)) < 12):
        errors.append("DIAGNOSTICS_API_KEY must be a unique random value of at least 32 characters when configured.")

    database_url = str(getattr(settings, "database_url", "") or "").lower()
    if not (database_url.startswith("postgresql://") or database_url.startswith("postgresql+psycopg://")):
        errors.append("DATABASE_URL must use PostgreSQL in production.")

    redis_url = str(getattr(settings, "redis_url", "") or "").lower()
    if not (redis_url.startswith("redis://") or redis_url.startswith("rediss://")):
        errors.append("REDIS_URL must point to a configured Redis service in production.")

    frontend_url = str(getattr(settings, "frontend_url", "") or "")
    if not _is_https_origin(frontend_url):
        errors.append("FRONTEND_URL must be a valid HTTPS origin without a path, query or fragment.")

    origins = [
        item.strip() for item in str(getattr(settings, "cors_origins", "") or "").split(",")
        if item.strip()
    ]
    if not origins:
        errors.append("CORS_ORIGINS must contain at least one explicit HTTPS origin.")
    elif any(origin == "*" or not _is_https_origin(origin) for origin in origins):
        errors.append("CORS_ORIGINS must contain only explicit HTTPS origins without paths; wildcard and HTTP origins are forbidden.")
    elif _is_https_origin(frontend_url):
        frontend = urlparse(frontend_url)
        frontend_origin = f"{frontend.scheme}://{frontend.netloc}".lower()
        allowed_origins = {
            f"{urlparse(origin).scheme}://{urlparse(origin).netloc}".lower()
            for origin in origins
        }
        if frontend_origin not in allowed_origins:
            errors.append("FRONTEND_URL must also be listed in CORS_ORIGINS.")

    for key, default, minimum, maximum in (
        ("login_failure_limit", 8, 3, 20),
        ("login_lockout_minutes", 15, 1, 1440),
        ("mfa_challenge_minutes", 5, 1, 15),
        ("mfa_challenge_max_attempts", 5, 1, 10),
    ):
        try:
            value = int(getattr(settings, key, default))
            if value < minimum or value > maximum:
                raise ValueError
        except (TypeError, ValueError):
            errors.append(f"{key.upper()} must be an integer between {minimum} and {maximum}.")

    for key, default in (
        ("rate_limit_api_per_minute", 120),
        ("rate_limit_auth_per_minute", 10),
        ("rate_limit_ai_per_minute", 30),
    ):
        try:
            value = int(getattr(settings, key, default))
            if value < 1 or value > 100000:
                raise ValueError
        except (TypeError, ValueError):
            errors.append(f"{key.upper()} must be an integer between 1 and 100000.")

    for key, default in (("ai_quota_daily_calls", 20), ("ai_quota_monthly_calls", 300)):
        try:
            value = int(getattr(settings, key, default))
            if value < 1 or value > 1000000:
                raise ValueError
        except (TypeError, ValueError):
            errors.append(f"{key.upper()} must be an integer between 1 and 1000000.")

    ai_provider = str(getattr(settings, "ai_provider", "ollama") or "").lower()
    embedding_provider = str(getattr(settings, "embedding_provider", "ollama") or "").lower()
    openai_key = str(getattr(settings, "openai_api_key", "") or "").strip()

    if ai_provider not in {"ollama", "openai"}:
        errors.append("AI_PROVIDER must be either ollama or openai.")
    elif ai_provider == "openai" and not openai_key:
        errors.append("OPENAI_API_KEY is required when AI_PROVIDER=openai.")

    if embedding_provider not in {"ollama", "openai", "lexical"}:
        errors.append("EMBEDDING_PROVIDER must be ollama, openai or lexical.")
    elif embedding_provider == "openai" and not openai_key:
        errors.append("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai.")

    if ai_provider == "ollama" or embedding_provider == "ollama":
        ollama_url = urlparse(str(getattr(settings, "ollama_base_url", "") or ""))
        if not ollama_url.scheme or not ollama_url.hostname:
            errors.append("OLLAMA_BASE_URL must be an absolute URL when Ollama generation or embeddings are enabled.")
        elif ollama_url.hostname.lower() in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
            errors.append("OLLAMA_BASE_URL cannot point to localhost in a cloud production deployment.")

    try:
        token_minutes = int(getattr(settings, "access_token_expire_minutes", 720))
        if token_minutes < 5 or token_minutes > 1440:
            raise ValueError
    except (TypeError, ValueError):
        errors.append("ACCESS_TOKEN_EXPIRE_MINUTES must be between 5 and 1440.")
    try:
        upload_limit = int(getattr(settings, "upload_max_mb", 10))
        if upload_limit < 1 or upload_limit > 100:
            raise ValueError
    except (TypeError, ValueError):
        errors.append("UPLOAD_MAX_MB must be between 1 and 100.")

    openai_base_url = str(getattr(settings, "openai_base_url", "") or "").strip()
    if openai_base_url:
        parsed_ai_url = urlparse(openai_base_url)
        if not parsed_ai_url.scheme or not parsed_ai_url.hostname:
            errors.append("OPENAI_BASE_URL must be an absolute URL when configured.")
        elif getattr(settings, "environment", "development") == "production" and parsed_ai_url.scheme != "https":
            errors.append("OPENAI_BASE_URL must use HTTPS in production.")

    email_verification_setting = getattr(settings, "require_email_verification", None)
    email_verification_required = bool(email_verification_setting)
    if getattr(settings, "environment", "development") == "production" and email_verification_setting is False:
        errors.append("REQUIRE_EMAIL_VERIFICATION must be true in production.")
    if email_verification_required and getattr(settings, "environment", "development") == "production":
        smtp_host = str(getattr(settings, "smtp_host", "") or "").strip()
        smtp_from = str(getattr(settings, "smtp_from_email", "") or "").strip()
        smtp_user = str(getattr(settings, "smtp_username", "") or "").strip()
        smtp_password = str(getattr(settings, "smtp_password", "") or "").strip()
        try:
            smtp_port = int(getattr(settings, "smtp_port", 587))
            if smtp_port < 1 or smtp_port > 65535:
                raise ValueError
        except (TypeError, ValueError):
            errors.append("SMTP_PORT must be between 1 and 65535.")
        if not smtp_host or not smtp_from:
            errors.append("SMTP_HOST and SMTP_FROM_EMAIL are required when email verification is enabled.")
        if bool(smtp_user) != bool(smtp_password):
            errors.append("SMTP_USERNAME and SMTP_PASSWORD must be configured together.")
        app_url = urlparse(str(getattr(settings, "public_app_url", "") or ""))
        if app_url.scheme != "https" or not app_url.hostname or app_url.path not in ("", "/"):
            errors.append("PUBLIC_APP_URL must be an HTTPS frontend origin when email verification is enabled.")

    oauth_configured = any([
        getattr(settings, "google_client_id", ""),
        getattr(settings, "google_client_secret", ""),
        getattr(settings, "microsoft_client_id", ""),
        getattr(settings, "microsoft_client_secret", ""),
    ])
    if oauth_configured and not getattr(settings, "oauth_encryption_key", ""):
        errors.append("OAUTH_ENCRYPTION_KEY is required when an email OAuth provider is configured.")
    if getattr(settings, "environment", "development") == "production":
        if getattr(settings, "google_client_id", "") and not str(getattr(settings, "google_redirect_uri", "")).startswith("https://"):
            errors.append("GOOGLE_REDIRECT_URI must use HTTPS in production.")
        if getattr(settings, "microsoft_client_id", "") and not str(getattr(settings, "microsoft_redirect_uri", "")).startswith("https://"):
            errors.append("MICROSOFT_REDIRECT_URI must use HTTPS in production.")

    upwork_values = [getattr(settings, key, "") for key in
                     ("upwork_client_id", "upwork_client_secret", "upwork_redirect_uri", "upwork_scopes")]
    if any(upwork_values) and not all(upwork_values):
        errors.append("UPWORK_CLIENT_ID, UPWORK_CLIENT_SECRET, UPWORK_REDIRECT_URI and UPWORK_SCOPES must be configured together.")
    if any(upwork_values) and not getattr(settings, "oauth_encryption_key", ""):
        errors.append("OAUTH_ENCRYPTION_KEY is required when Upwork OAuth is configured.")
    if getattr(settings, "environment", "development") == "production" and getattr(settings, "upwork_redirect_uri", "") and not str(settings.upwork_redirect_uri).startswith("https://"):
        errors.append("UPWORK_REDIRECT_URI must use HTTPS in production.")

    if getattr(settings, "public_registration", False):
        warnings.append("PUBLIC_REGISTRATION is enabled; disable it after account onboarding.")
    if not diagnostics_key:
        warnings.append("DIAGNOSTICS_API_KEY is not configured; the protected system diagnostics endpoint is disabled.")

    return {"valid": not errors, "errors": errors, "warnings": warnings}
