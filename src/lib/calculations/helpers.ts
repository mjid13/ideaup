import type { Assumption, BillingPeriod } from "@/types";

/** Reads the numeric value out of an Assumption, or a plain number. */
export function val(a: Assumption<number> | number | undefined | null, fallback = 0): number {
  if (a === undefined || a === null) return fallback;
  if (typeof a === "number") return Number.isFinite(a) ? a : fallback;
  return Number.isFinite(a.value) ? a.value : fallback;
}

/**
 * Reads an optional assumption, falling back to `fallback` when the field is
 * absent (project saved before it existed) or still pristine — a 0 marked
 * "unknown" means "not answered", not "zero".
 */
export function valOrDefault(assumption: Assumption<number> | undefined, fallback: number): number {
  if (!assumption) return fallback;
  if (assumption.quality === "unknown" && assumption.value === 0) return fallback;
  return val(assumption, fallback);
}

/** Safe division that never produces NaN/Infinity. Returns `fallback` (default null) on an invalid divide. */
export function safeDiv(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/** Same as safeDiv but returns 0 instead of null for cases where a chart/sum needs a number. */
export function safeDivOrZero(numerator: number, denominator: number): number {
  const r = safeDiv(numerator, denominator);
  return r === null ? 0 : r;
}

export function pct(value: number): number {
  return value / 100;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Converts a price on any billing period into a normalized monthly ARPU. */
export function normalizeToMonthlyArpu(price: number, billingPeriod: BillingPeriod): number {
  switch (billingPeriod) {
    case "annual":
      return price / 12;
    case "quarterly":
      return price / 3;
    case "monthly":
    case "usage_based":
      return price;
    case "one_time":
      // One-time purchases don't recur; treat the price itself as the per-transaction ARPU
      // and let callers avoid monthly-recurring metrics (MRR/ARR) for this billing type.
      return price;
    default:
      return price;
  }
}

export function isRecurring(billingPeriod: BillingPeriod): boolean {
  return billingPeriod === "monthly" || billingPeriod === "quarterly" || billingPeriod === "annual" || billingPeriod === "usage_based";
}

/** Guards against NaN/Infinity ever reaching the UI layer. */
export function finiteOrZero(n: number): number {
  return Number.isFinite(n) ? n : 0;
}
