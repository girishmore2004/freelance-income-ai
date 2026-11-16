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

export interface Env {
  APP_NAME?: string;
  APP_VERSION?: string;
  APP_ENV?: string;
  CORS_ORIGINS?: string;

  HYPERDRIVE: HyperdriveBinding;
  FREELANCE_JOBS?: QueueProducer;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  WORKERS_AI_MODEL?: string;
  FREELANCER_TOKEN?: string;
  INCLUDE_JOB_BOARDS?: string;

  // Authentication secrets must be configured as Cloudflare secrets.
  JWT_SECRET?: string;
  DATABASE_URL?: string;

  // Original application settings
  PUBLIC_REGISTRATION?: string;
  REQUIRE_EMAIL_VERIFICATION?: string;
  ACCESS_TOKEN_EXPIRE_MINUTES?: string;

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

  OAUTH_ENCRYPTION_KEY?: string;
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
