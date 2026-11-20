export interface HyperdriveBinding {
  connectionString: string;
}

export interface QueueMessage {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatch {
  queue: string;
  messages: QueueMessage[];
  ackAll(): void;
  retryAll(options?: { delaySeconds?: number }): void;
}

export interface QueueProducer {
  send(
    message: unknown,
    options?: { contentType?: "json" | "text" | "bytes" | "v8" }
  ): Promise<void>;
}

export interface RateLimiterBinding {
  limit(options: { key: string; delta?: number }): Promise<{ success: boolean }>;
}

/** Minimal Cloudflare R2 bucket surface used by lib/file-routes.ts. */
export interface R2BucketBinding {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; contentDisposition?: string }; customMetadata?: Record<string, string> }
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
}

export interface Env {
  APP_NAME?: string;
  APP_VERSION?: string;
  APP_ENV?: string;
  CORS_ORIGINS?: string;

  HYPERDRIVE: HyperdriveBinding;
  // R2 bucket for contract files (optional until the bucket exists; see DEPLOYMENT_RUNBOOK "Files").
  FILES?: R2BucketBinding;
  FREELANCE_JOBS?: QueueProducer;
  // Cloudflare Rate Limiting bindings (wrangler.jsonc "ratelimits").
  AUTH_RATE_LIMITER?: RateLimiterBinding;
  API_RATE_LIMITER?: RateLimiterBinding;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  WORKERS_AI_MODEL?: string;
  // AI cost controls (see lib/ai-governor.ts). Prices: USD per 1M tokens, from the provider's pricing page.
  AI_QUOTA_DAILY_CALLS?: string;
  AI_QUOTA_MONTHLY_CALLS?: string;
  AI_GLOBAL_DAILY_BUDGET_USD?: string;
  AI_COST_INPUT_USD_PER_MTOK?: string;
  AI_COST_OUTPUT_USD_PER_MTOK?: string;
  AI_BUDGET_ALERT_RATIO?: string;
  // Comma-separated feature flag keys forced OFF (emergency kill switch; "*" = all).
  FEATURE_FLAGS_OFF?: string;
  FREELANCER_TOKEN?: string;
  /** "true" only once Reddit has granted a data agreement for commercial use (Public Content Policy, 2024). */
  REDDIT_DATA_AGREEMENT?: string;
  INCLUDE_JOB_BOARDS?: string;

  // Authentication secrets must be configured as Cloudflare secrets.
  JWT_SECRET?: string;
  DATABASE_URL?: string;

  // Original application settings
  PUBLIC_REGISTRATION?: string;
  REQUIRE_EMAIL_VERIFICATION?: string;
  ACCESS_TOKEN_EXPIRE_MINUTES?: string;
  // "false" disables Authorization: Bearer for browser sessions (cookie mode only).
  AUTH_ALLOW_BEARER?: string;

  LOGIN_FAILURE_LIMIT?: string;
  LOGIN_LOCKOUT_MINUTES?: string;
  MFA_CHALLENGE_MINUTES?: string;
  MFA_CHALLENGE_MAX_ATTEMPTS?: string;

  RATE_LIMIT_API_PER_MINUTE?: string;
  RATE_LIMIT_AUTH_PER_MINUTE?: string;
  RATE_LIMIT_AI_PER_MINUTE?: string;

  FRONTEND_URL?: string;
  PUBLIC_APP_URL?: string;

  EMAIL_PROVIDER?: string;
  /** HMAC secret for webhooks of a live payment provider (not used until D-2). */
  PAYMENT_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  RESEND_API_BASE_URL?: string;

  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_USE_SSL?: string;

  // Independent of JWT_SECRET. Base64/base64url, >= 32 bytes (a Fernet key works).
  OAUTH_ENCRYPTION_KEY?: string;
  /** K-04: dedicated key for MFA secrets. Unset = JWT_SECRET (legacy). Old secrets keep working and move to this key at next sign-in. */
  MFA_ENCRYPTION_KEY?: string;
  // Set only during key rotation; remove once the cron reports no remaining values.
  OAUTH_ENCRYPTION_KEY_PREVIOUS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;

  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_REDIRECT_URI?: string;

  UPWORK_CLIENT_ID?: string;
  UPWORK_CLIENT_SECRET?: string;
  UPWORK_REDIRECT_URI?: string;
  UPWORK_SCOPES?: string;
  UPWORK_CACHE_RETENTION_ENABLED?: string;
}

export interface RequestContext {
  requestId: string;
  startedAt: number;
}
