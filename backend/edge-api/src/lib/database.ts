
import postgres from "postgres";
import type { Env } from "../types";

type SqlClient = ReturnType<typeof postgres>;

let cachedConnectionString: string | undefined;
let cachedClient: SqlClient | undefined;

export function getDatabase(env: Env): SqlClient {
  const connectionString = env.HYPERDRIVE?.connectionString;

  if (!connectionString) {
    throw new Error(
      "HYPERDRIVE connectionString binding is missing"
    );
  }

  if (
    cachedClient &&
    cachedConnectionString === connectionString
  ) {
    return cachedClient;
  }

  cachedClient = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    fetch_types: false,
    ssl: "require"
  });

  cachedConnectionString = connectionString;

  return cachedClient;
}

export async function checkDatabase(
  env: Env
): Promise<{
  connected: boolean;
  result: number;
}> {
  const sql = getDatabase(env);

  const rows = await sql<{ value: number }[]>`
    SELECT 1 AS value
  `;

  if (Number(rows[0]?.value) !== 1) {
    throw new Error("Unexpected database health-check result");
  }

  return {
    connected: true,
    result: 1
  };
}
