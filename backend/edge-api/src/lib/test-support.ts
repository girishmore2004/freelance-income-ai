import type { Sql } from "./core-routes";

/**
 * Test-only scripted SQL double. Each tagged-template query is passed to the
 * handler with its normalised text and bound values; the handler returns the
 * rows. `begin` runs the callback against the same double and rolls back the
 * recorded "committed" flag when the callback throws, so tests can assert
 * transactional behaviour.
 */
export interface FakeQuery {
  text: string;
  values: unknown[];
  inTransaction: boolean;
}

export interface FakeSql {
  sql: Sql;
  queries: FakeQuery[];
  commits: number;
  rollbacks: number;
}

export function createFakeSql(handler: (text: string, values: unknown[]) => unknown[] | Promise<unknown[]>): FakeSql {
  const state: FakeSql = { sql: undefined as unknown as Sql, queries: [], commits: 0, rollbacks: 0 };
  let depth = 0;

  const run = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    state.queries.push({ text, values, inTransaction: depth > 0 });
    const rows = await handler(text, values);
    return Object.assign([...rows], { count: rows.length });
  };

  const fn = Object.assign(run, {
    begin: async <T>(callback: (tx: Sql) => Promise<T>): Promise<T> => {
      depth += 1;
      try {
        const result = await callback(fn as unknown as Sql);
        state.commits += 1;
        return result;
      } catch (error) {
        state.rollbacks += 1;
        throw error;
      } finally {
        depth -= 1;
      }
    },
    end: async () => undefined
  });

  state.sql = fn as unknown as Sql;
  return state;
}

export function jsonRequest(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
}

export async function readJson(response: Response): Promise<{ success: boolean; message: string; data: any; error: { code: string } | null }> {
  return (await response.json()) as { success: boolean; message: string; data: any; error: { code: string } | null };
}
