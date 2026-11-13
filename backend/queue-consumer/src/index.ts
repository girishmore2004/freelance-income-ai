
interface QueueJob {
  event_id: string;
  event_type: string;
  source: string;
  created_at: string;
  payload: Record<string, unknown>;
}

interface Env {
  // Add future bindings here when the corresponding
  // infrastructure and processing handlers are implemented.
}

interface QueueMessage {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface MessageBatch {
  queue: string;
  messages: QueueMessage[];
}

type JobResult = {
  status: "processed";
  event_id: string;
  event_type: string;
};

const SERVICE_NAME = "freelance-income-ai-consumer";
const SUPPORTED_EVENTS = new Set([
  "infrastructure.health_check"
]);

function isValidJob(value: unknown): value is QueueJob {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Record<string, unknown>;

  return (
    typeof job.event_id === "string" &&
    job.event_id.length > 0 &&
    typeof job.event_type === "string" &&
    typeof job.source === "string" &&
    typeof job.created_at === "string" &&
    typeof job.payload === "object" &&
    job.payload !== null &&
    !Array.isArray(job.payload)
  );
}

async function processJob(job: QueueJob): Promise<JobResult> {
  switch (job.event_type) {
    case "infrastructure.health_check": {
      console.log(
        JSON.stringify({
          service: SERVICE_NAME,
          action: "health_check_processed",
          event_id: job.event_id,
          source: job.source,
          processed_at: new Date().toISOString()
        })
      );

      return {
        status: "processed",
        event_id: job.event_id,
        event_type: job.event_type
      };
    }

    default:
      throw new Error(
        `Unsupported event type: ${job.event_type}`
      );
  }
}

async function processMessage(
  message: QueueMessage
): Promise<void> {
  try {
    if (!isValidJob(message.body)) {
      throw new Error("Invalid queue message schema");
    }

    const result = await processJob(message.body);

    // Acknowledge only after processing succeeds.
    message.ack();

    console.log(
      JSON.stringify({
        service: SERVICE_NAME,
        action: "message_acknowledged",
        queue_message_id: message.id,
        event_id: result.event_id,
        event_type: result.event_type,
        attempts: message.attempts
      })
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown processing error";

    console.error(
      JSON.stringify({
        service: SERVICE_NAME,
        action: "message_processing_failed",
        queue_message_id: message.id,
        attempts: message.attempts,
        error: errorMessage
      })
    );

    // Cloudflare handles the retry limit and DLQ routing
    // using the consumer settings in wrangler.jsonc.
    message.retry({
      delaySeconds: 30
    });
  }
}

export default {
  async queue(
    batch: MessageBatch,
    _env: Env
  ): Promise<void> {
    console.log(
      JSON.stringify({
        service: SERVICE_NAME,
        action: "batch_received",
        queue: batch.queue,
        message_count: batch.messages.length
      })
    );

    for (const message of batch.messages) {
      await processMessage(message);
    }
  }
};
