
import postgres from "postgres";
import type { Env } from "../types";

export async function checkDatabase(
  env: Env
): Promise<{
  connected: boolean;
  result: number;
}> {
  const connectionString =
    env.HYPERDRIVE?.connectionString;

  if (!connectionString) {
    throw new Error(
      "HYPERDRIVE connectionString binding is missing"
    );
  }

  // Hyperdrive maintains the underlying connection pool.
  // Create a lightweight driver client for this request.
  const sql = postgres(connectionString, {
    max: 5,
    fetch_types: false,
    prepare: true,
    connection: {
      application_name: "Freelance Income AI Edge API"
    }
  });

  const rows = await sql<{ value: number }[]>`
    SELECT 1 AS value
  `;

  const result = Number(rows[0]?.value);

  if (result !== 1) {
    throw new Error(
      "Unexpected PostgreSQL health-check result"
    );
  }

  return {
    connected: true,
    result
  };
}
