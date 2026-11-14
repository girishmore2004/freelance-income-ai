
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
    options?: {
      contentType?: "json" | "text" | "bytes" | "v8";
    }
  ): Promise<void>;
}

export interface Env {
  APP_NAME?: string;
  APP_VERSION?: string;
  APP_ENV?: string;
  CORS_ORIGINS?: string;

  HYPERDRIVE: HyperdriveBinding;
  FREELANCE_JOBS?: QueueProducer;

  JWT_SECRET?: string;
  DATABASE_URL?: string;
}

export interface RequestContext {
  requestId: string;
  startedAt: number;
}
