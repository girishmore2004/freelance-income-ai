from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    app_name: str = "Freelance Income AI"
    environment: str = "development"
    secret_key: str = "unsafe-development-secret-change-me"
    access_token_expire_minutes: int = 720
    database_url: str = "sqlite:///./freelance_ai.db"
    cors_origins: str = "http://localhost:3000"
    frontend_url: str = "http://localhost:3000"
    ai_provider: str = "ollama"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:3b"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = ""
    rss_allowed_domains: str = ""
    max_rss_items_per_feed: int = 30
    n8n_webhook_secret: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    upload_max_mb: int = 10
    redis_url: str = ""
    rate_limit_api_per_minute: int = 120
    rate_limit_auth_per_minute: int = 10
    rate_limit_ai_per_minute: int = 30
    ai_quota_daily_calls: int = 20
    ai_quota_monthly_calls: int = 300
    embedding_provider: str = "ollama"
    ollama_embedding_model: str = "nomic-embed-text"
    openai_embedding_model: str = "text-embedding-3-small"
    retrieval_top_k: int = 6
    retrieval_min_score: float = 0.12
    retrieval_backend: str = "auto"
    retrieval_candidate_limit: int = 1000
    public_registration: bool = False
    diagnostics_api_key: str = ""
    require_email_verification: bool = False
    login_failure_limit: int = 8
    login_lockout_minutes: int = 15
    mfa_challenge_minutes: int = 5
    mfa_challenge_max_attempts: int = 5
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "Freelance Income AI"
    smtp_use_ssl: bool = False
    public_app_url: str = "http://localhost:3000"
    # Email OAuth: configure redirect URIs exactly as registered with each provider.
    oauth_encryption_key: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant_id: str = "common"
    microsoft_redirect_uri: str = ""
    upwork_client_id: str = ""
    upwork_client_secret: str = ""
    upwork_redirect_uri: str = ""
    upwork_scopes: str = ""
    upwork_cache_retention_enabled: bool = False
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    @property
    def cors_list(self):
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]

@lru_cache
def get_settings():
    return Settings()

settings = get_settings()
