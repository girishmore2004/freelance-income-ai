
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

  const sql = postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: {
      application_name: "Freelance Income AI Edge API"
    }
  });

  try {
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
  } finally {
    await sql.end({
      timeout: 5
    });
  }
}
