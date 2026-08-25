import type {
  Project,
  RevenueMixMetrics,
  RevenueStream,
  RevenueStreamKind,
  RevenueStreamMetrics,
} from "@/types";
import { normalizeToMonthlyArpu, pct, safeDivOrZero, val } from "./helpers";

/** Recurring kinds keep billing an existing customer every month; `one_time` bills only on acquisition. */
export function isRecurringStream(kind: RevenueStreamKind): boolean {
  return kind !== "one_time";
}

/**
 * An unset attach rate means "everyone buys this", and an unset unit count
 * means "one per customer per month" — otherwise a founder who fills in only a
 * price would see the stream silently contribute zero revenue.
 */
function assumptionOrDefault(assumption: RevenueStream["price"] | undefined, fallback: number): number {
  if (!assumption || assumption.quality === "unknown") return fallback;
  return val(assumption, fallback);
}

/** A stream counts once the founder has entered a real price for it. */
export function hasStreamData(stream: RevenueStream): boolean {
  return stream.price.quality !== "unknown" && val(stream.price) > 0;
}

/** Streams that carry real data — the ones that override the single-price `pricing` model wherever they're read. */
export function getActiveRevenueStreams(project: Project): RevenueStream[] {
  return (project.revenueStreams ?? []).filter(hasStreamData);
}

export interface RevenueMixContext {
  /** Paying customers today — drives the recurring half of the mix. */
  currentCustomers: number;
  /** Customers acquired per month — drives the one-time half (a flow, not a stock). */
  newCustomersPerMonth: number;
}

interface StreamShape {
  metrics: RevenueStreamMetrics;
  /** Per-customer revenue before it is spread across the whole base. */
  perCustomer: number;
}

function shapeStream(stream: RevenueStream, context: RevenueMixContext): StreamShape {
  const price = val(stream.price);
  const attachRate = pct(assumptionOrDefault(stream.attachRatePct, 100));
  const units = assumptionOrDefault(stream.unitsPerCustomerPerMonth, 1);
  const grossMarginPct = 100 - val(stream.deliveryCostPct);

  let perCustomer: number;
  let gmvPerCustomer = 0;

  switch (stream.kind) {
    case "recurring":
      // Annual contracts are normalized to a monthly figure so a $12k/yr
      // platform and a $1k/mo platform blend into the same ARPU.
      perCustomer = normalizeToMonthlyArpu(price, stream.billingPeriod) * attachRate;
      break;
    case "usage":
      perCustomer = price * units * attachRate;
      break;
    case "transactional":
      gmvPerCustomer = price * units * attachRate;
      perCustomer = gmvPerCustomer * pct(assumptionOrDefault(stream.takeRatePct, 0));
      break;
    case "one_time":
    default:
      // Charged per acquisition, so `units` reads as purchases per customer
      // (1 for a single setup fee, 2 for audit-then-implementation).
      perCustomer = price * units * attachRate;
      break;
  }

  const isRecurring = isRecurringStream(stream.kind);
  const customers = isRecurring ? context.currentCustomers : context.newCustomersPerMonth;
  const monthlyRevenue = perCustomer * customers;

  return {
    perCustomer,
    metrics: {
      id: stream.id,
      name: stream.name,
      kind: stream.kind,
      isRecurring,
      monthlyRevenue,
      revenueSharePct: 0, // filled in once the total is known
      revenuePerCustomer: perCustomer,
      grossMarginPct,
      monthlyGrossProfit: monthlyRevenue * pct(grossMarginPct),
      monthlyGmv: isRecurring ? gmvPerCustomer * customers : 0,
    },
  };
}

/**
 * Blends any number of revenue streams into one economic picture. Streams are
 * split into the half that repeats (recurring / usage / take rate) and the half
 * that is earned once on acquisition (audit, setup, implementation), because
 * the two behave differently everywhere downstream: recurring revenue
 * compounds into LTV and survives a hiring freeze, one-time revenue scales only
 * with new sales and offsets CAC.
 *
 * Returns null when no stream carries a price yet, leaving the single-price
 * `pricing` model in charge.
 */
export function calculateRevenueMix(
  streams: RevenueStream[] | undefined,
  context: RevenueMixContext
): RevenueMixMetrics | null {
  const active = (streams ?? []).filter(hasStreamData);
  if (active.length === 0) return null;

  const shaped = active.map((stream) => shapeStream(stream, context));

  const recurring = shaped.filter((s) => s.metrics.isRecurring);
  const oneTime = shaped.filter((s) => !s.metrics.isRecurring);

  const recurringArpu = recurring.reduce((sum, s) => sum + s.perCustomer, 0);
  const oneTimeRevenuePerNewCustomer = oneTime.reduce((sum, s) => sum + s.perCustomer, 0);
  const blendedAnnualRevenuePerCustomer = recurringArpu * 12 + oneTimeRevenuePerNewCustomer;

  const monthlyRecurringRevenue = recurring.reduce((sum, s) => sum + s.metrics.monthlyRevenue, 0);
  const monthlyOneTimeRevenue = oneTime.reduce((sum, s) => sum + s.metrics.monthlyRevenue, 0);
  const totalMonthlyRevenue = monthlyRecurringRevenue + monthlyOneTimeRevenue;

  // Margins are weighted by per-customer revenue rather than monthly revenue so
  // they stay meaningful before the project has any customers entered — a
  // customer-less project would otherwise report a 0% margin on every stream.
  const weightedMargin = (group: StreamShape[]) => {
    const revenue = group.reduce((sum, s) => sum + s.perCustomer, 0);
    if (revenue <= 0) return 0;
    return group.reduce((sum, s) => sum + s.perCustomer * s.metrics.grossMarginPct, 0) / revenue;
  };

  const recurringGrossMarginPct = weightedMargin(recurring);
  const oneTimeGrossMarginPct = weightedMargin(oneTime);
  const blendedGrossMarginPct = weightedMargin(shaped);

  const streamMetrics = shaped.map((s) => ({
    ...s.metrics,
    revenueSharePct: safeDivOrZero(s.metrics.monthlyRevenue, totalMonthlyRevenue) * 100,
  }));

  return {
    streams: streamMetrics,
    recurringArpu,
    oneTimeRevenuePerNewCustomer,
    blendedAnnualRevenuePerCustomer,
    monthlyRecurringRevenue,
    monthlyOneTimeRevenue,
    totalMonthlyRevenue,
    recurringRevenueSharePct: safeDivOrZero(monthlyRecurringRevenue, totalMonthlyRevenue) * 100,
    blendedGrossMarginPct,
    recurringGrossMarginPct,
    oneTimeGrossMarginPct,
    monthlyGmv: streamMetrics.reduce((sum, s) => sum + s.monthlyGmv, 0),
  };
}
