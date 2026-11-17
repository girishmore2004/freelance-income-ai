import type { Queryable } from "./core-routes";

/** Append-only contract activity log (table `contract_events`, migration 0054). */
export type ActorParty = "client" | "freelancer" | "system";

export async function recordContractEvent(
  sql: Queryable,
  contractId: string,
  actorUserId: string | null,
  actorParty: ActorParty,
  eventType: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await sql`
    INSERT INTO contract_events (id, contract_id, actor_user_id, actor_party, event_type, details_json, created_at)
    VALUES (${crypto.randomUUID()}, ${contractId}, ${actorUserId}, ${actorParty}, ${eventType}, ${JSON.stringify(details)}, now())
  `;
}
