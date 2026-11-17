/**
 * Platform fee engine (Phase 4). Rates come only from an approved
 * `fee_schedules` row (founder decision D-5); nothing is hardcoded.
 *
 * Integer arithmetic in minor units, rounding half up per side. The minimum
 * fee applies to the combined platform fee; any top-up is added to the client
 * side (an assumption recorded in BUSINESS_DECISIONS until D-5 says otherwise).
 */

export interface FeeSchedule {
  id: string;
  currency: string;
  client_fee_bps: number;
  freelancer_fee_bps: number;
  min_fee_minor: number;
}

export interface FeeQuote {
  schedule_id: string;
  currency: string;
  amount_minor: number;
  client_fee_minor: number;
  freelancer_fee_minor: number;
  client_pays_minor: number;
  freelancer_receives_minor: number;
  platform_fee_minor: number;
}

export function bpsOf(amountMinor: number, bps: number): number {
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}

export function quoteFees(amountMinor: number, schedule: FeeSchedule): FeeQuote {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error("Amount must be a positive whole number of minor units.");
  let client = bpsOf(amountMinor, schedule.client_fee_bps);
  const freelancer = bpsOf(amountMinor, schedule.freelancer_fee_bps);
  const shortfall = Math.max(0, schedule.min_fee_minor - (client + freelancer));
  client += shortfall;
  return {
    schedule_id: schedule.id,
    currency: schedule.currency,
    amount_minor: amountMinor,
    client_fee_minor: client,
    freelancer_fee_minor: freelancer,
    client_pays_minor: amountMinor + client,
    freelancer_receives_minor: amountMinor - freelancer,
    platform_fee_minor: client + freelancer
  };
}

export function validateSchedule(input: Record<string, unknown>): { ok: true; value: Omit<FeeSchedule, "id"> & { name: string } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 3 || name.length > 120) errors.name = "Name must be 3 to 120 characters.";
  const currency = typeof input.currency === "string" ? input.currency : "";
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Use a 3-letter currency code.";
  const bps = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3000;
  if (!bps(input.client_fee_bps)) errors.client_fee_bps = "Client fee must be 0–3000 basis points (0–30%).";
  if (!bps(input.freelancer_fee_bps)) errors.freelancer_fee_bps = "Freelancer fee must be 0–3000 basis points (0–30%).";
  const min = input.min_fee_minor ?? 0;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 0 || min > 10_000_000) errors.min_fee_minor = "Minimum fee must be 0–₹1,00,000 in minor units.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { name, currency, client_fee_bps: input.client_fee_bps as number, freelancer_fee_bps: input.freelancer_fee_bps as number, min_fee_minor: min as number }
  };
}
