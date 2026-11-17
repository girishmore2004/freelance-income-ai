import type { Queryable, Sql } from "./core-routes";

/**
 * Double-entry ledger (Phase 4 foundation).
 *
 * Every money movement will be a journal entry whose debits equal its credits
 * per currency, in integer minor units, posted once per idempotency key.
 * PostgreSQL enforces the same rules (deferred balance trigger, append-only
 * rows; migration 0056), so a bug here cannot write an unbalanced or edited
 * entry. Corrections are reversal entries.
 *
 * Only `sandbox` entries can be posted. Live posting is refused in code until
 * the legal entity and payment provider are approved (D-1/D-2) and a live
 * provider adapter exists; the `payments.live` flag alone does not enable it.
 */

export type AccountKind = "asset" | "liability" | "revenue" | "expense" | "equity";
export type OwnerType = "platform" | "organization" | "user" | "provider";
export type Direction = "debit" | "credit";
export type LedgerMode = "sandbox" | "live";

export interface AccountRef {
  code: string;
  name: string;
  kind: AccountKind;
  owner_type?: OwnerType;
  owner_id?: string | null;
}

export interface LineInput {
  account: AccountRef;
  direction: Direction;
  amount_minor: number;
}

export interface EntryInput {
  idempotency_key: string;
  entry_type: string;
  description?: string;
  mode: LedgerMode;
  currency: string;
  contract_id?: string | null;
  created_by?: string | null;
  reverses_entry_id?: string | null;
  lines: LineInput[];
}

export const MAX_LINE_MINOR = 100_000_000_000;

export class LedgerError extends Error {
  constructor(readonly code: "UNBALANCED" | "INVALID_LINES" | "LIVE_DISABLED" | "INVALID_ENTRY", message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Pure validation; throws LedgerError. */
export function assertValidEntry(entry: EntryInput): void {
  if (entry.mode === "live") {
    throw new LedgerError("LIVE_DISABLED", "Live ledger posting is disabled until payments are approved (D-1/D-2).");
  }
  if (!/^[\w.:/-]{8,200}$/.test(entry.idempotency_key)) throw new LedgerError("INVALID_ENTRY", "Idempotency key must be 8–200 safe characters.");
  if (!/^[a-z_.]{3,60}$/.test(entry.entry_type)) throw new LedgerError("INVALID_ENTRY", "Entry type must be 3–60 lowercase characters.");
  if (!/^[A-Z]{3}$/.test(entry.currency)) throw new LedgerError("INVALID_ENTRY", "Currency must be a 3-letter code.");
  if (entry.lines.length < 2) throw new LedgerError("INVALID_LINES", "An entry needs at least two lines.");
  let balance = 0;
  for (const line of entry.lines) {
    if (!Number.isInteger(line.amount_minor) || line.amount_minor <= 0 || line.amount_minor > MAX_LINE_MINOR) {
      throw new LedgerError("INVALID_LINES", "Line amounts must be positive whole minor units.");
    }
    if (!/^[a-z0-9_.:-]{3,160}$/.test(line.account.code)) throw new LedgerError("INVALID_LINES", `Invalid account code "${line.account.code}".`);
    balance += line.direction === "debit" ? line.amount_minor : -line.amount_minor;
  }
  if (balance !== 0) throw new LedgerError("UNBALANCED", `Debits and credits differ by ${balance} minor units.`);
}

async function ensureAccount(tx: Queryable, ref: AccountRef, currency: string): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO ledger_accounts (id, code, name, kind, currency, owner_type, owner_id, created_at)
    VALUES (${crypto.randomUUID()}, ${ref.code}, ${ref.name}, ${ref.kind}, ${currency}, ${ref.owner_type ?? "platform"}, ${ref.owner_id ?? null}, now())
    ON CONFLICT (code, currency) DO UPDATE SET name = ledger_accounts.name
    RETURNING id
  `;
  return rows[0].id;
}

export interface PostResult {
  entry_id: string;
  duplicate: boolean;
}

/**
 * Posts an entry exactly once per idempotency key. A repeated key returns the
 * existing entry without writing anything.
 */
export async function postEntry(sql: Sql, entry: EntryInput): Promise<PostResult> {
  assertValidEntry(entry);
  return sql.begin(async (tx) => {
    const id = crypto.randomUUID();
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO ledger_entries (id, idempotency_key, entry_type, description, mode, contract_id, reverses_entry_id, created_by, created_at)
      VALUES (${id}, ${entry.idempotency_key}, ${entry.entry_type}, ${(entry.description ?? "").slice(0, 300)}, ${entry.mode},
              ${entry.contract_id ?? null}, ${entry.reverses_entry_id ?? null}, ${entry.created_by ?? null}, now())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (!inserted[0]) {
      const existing = await tx<{ id: string }[]>`SELECT id FROM ledger_entries WHERE idempotency_key = ${entry.idempotency_key} LIMIT 1`;
      return { entry_id: existing[0].id, duplicate: true };
    }
    for (const line of entry.lines) {
      const accountId = await ensureAccount(tx, line.account, entry.currency);
      await tx`
        INSERT INTO ledger_lines (id, entry_id, account_id, direction, amount_minor, currency)
        VALUES (${crypto.randomUUID()}, ${id}, ${accountId}, ${line.direction}, ${line.amount_minor}, ${entry.currency})
      `;
    }
    return { entry_id: id, duplicate: false };
  });
}

/** Mirror image of an entry (debits ↔ credits), linked to the original. */
export async function reverseEntry(sql: Sql, entryId: string, idempotencyKey: string, createdBy: string | null, reason: string): Promise<PostResult> {
  const lines = await sql<{ code: string; name: string; kind: AccountKind; owner_type: OwnerType; owner_id: string | null; direction: Direction; amount_minor: string | number; currency: string; mode: LedgerMode; contract_id: string | null }[]>`
    SELECT a.code, a.name, a.kind, a.owner_type, a.owner_id, l.direction, l.amount_minor, l.currency, e.mode, e.contract_id
    FROM ledger_lines l
    JOIN ledger_accounts a ON a.id = l.account_id
    JOIN ledger_entries e ON e.id = l.entry_id
    WHERE l.entry_id = ${entryId}
  `;
  if (!lines.length) throw new LedgerError("INVALID_ENTRY", "Entry not found.");
  return postEntry(sql, {
    idempotency_key: idempotencyKey,
    entry_type: "reversal",
    description: reason,
    mode: lines[0].mode,
    currency: lines[0].currency,
    contract_id: lines[0].contract_id,
    created_by: createdBy,
    reverses_entry_id: entryId,
    lines: lines.map((l) => ({
      account: { code: l.code, name: l.name, kind: l.kind, owner_type: l.owner_type, owner_id: l.owner_id },
      direction: l.direction === "debit" ? "credit" : "debit",
      amount_minor: Number(l.amount_minor)
    }))
  });
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  kind: AccountKind;
  currency: string;
  debit_minor: number;
  credit_minor: number;
  /** Natural-side balance: debit − credit for assets/expenses, credit − debit otherwise. */
  balance_minor: number;
}

export function naturalBalance(kind: AccountKind, debit: number, credit: number): number {
  return kind === "asset" || kind === "expense" ? debit - credit : credit - debit;
}

export async function trialBalance(sql: Queryable, mode: LedgerMode): Promise<{ rows: TrialBalanceRow[]; totals: Record<string, { debit_minor: number; credit_minor: number; balanced: boolean }> }> {
  const rows = await sql<{ code: string; name: string; kind: AccountKind; currency: string; debit_minor: string | number; credit_minor: string | number }[]>`
    SELECT a.code, a.name, a.kind, l.currency,
           COALESCE(sum(l.amount_minor) FILTER (WHERE l.direction = 'debit'), 0) AS debit_minor,
           COALESCE(sum(l.amount_minor) FILTER (WHERE l.direction = 'credit'), 0) AS credit_minor
    FROM ledger_lines l
    JOIN ledger_accounts a ON a.id = l.account_id
    JOIN ledger_entries e ON e.id = l.entry_id
    WHERE e.mode = ${mode}
    GROUP BY a.code, a.name, a.kind, l.currency
    ORDER BY l.currency, a.kind, a.code
  `;
  const totals: Record<string, { debit_minor: number; credit_minor: number; balanced: boolean }> = {};
  const out = rows.map((r) => {
    const debit = Number(r.debit_minor);
    const credit = Number(r.credit_minor);
    const t = (totals[r.currency] ??= { debit_minor: 0, credit_minor: 0, balanced: true });
    t.debit_minor += debit;
    t.credit_minor += credit;
    return { code: r.code, name: r.name, kind: r.kind, currency: r.currency, debit_minor: debit, credit_minor: credit, balance_minor: naturalBalance(r.kind, debit, credit) };
  });
  for (const t of Object.values(totals)) t.balanced = t.debit_minor === t.credit_minor;
  return { rows: out, totals };
}
