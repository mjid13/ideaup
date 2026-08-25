import type { BillingPeriod, BusinessModel, Currency, FundingRoundType, RevenueStreamKind } from "@/types";

export const BUSINESS_MODEL_OPTIONS: Array<{ value: BusinessModel; label: string }> = [
  { value: "saas", label: "SaaS" },
  { value: "subscription", label: "Subscription" },
  { value: "marketplace", label: "Marketplace" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "one_time", label: "One-time purchase" },
  { value: "service", label: "Service" },
  { value: "usage_based", label: "Usage-based" },
  { value: "other", label: "Other" },
];

export const CURRENCY_OPTIONS: Array<{ value: Currency; label: string }> = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "OMR", label: "OMR — Omani Rial" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
];

export const BILLING_PERIOD_OPTIONS: Array<{ value: BillingPeriod; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One-time" },
  { value: "usage_based", label: "Usage-based" },
];

export const REVENUE_STREAM_KIND_OPTIONS: Array<{ value: RevenueStreamKind; label: string; description: string }> = [
  { value: "one_time", label: "One-time", description: "Charged once per customer — an audit, a setup fee, an implementation project." },
  { value: "recurring", label: "Recurring", description: "Charged every period for as long as the customer stays — platform, retainer, support." },
  { value: "usage", label: "Usage-based", description: "Metered consumption billed monthly — AI tokens, API calls, processed volume." },
  { value: "transactional", label: "Transactional", description: "A cut of the transaction volume flowing through the product." },
];

export const REVENUE_STREAM_KIND_LABELS: Record<RevenueStreamKind, string> = Object.fromEntries(
  REVENUE_STREAM_KIND_OPTIONS.map((o) => [o.value, o.label])
) as Record<RevenueStreamKind, string>;

/**
 * Starting points for a hybrid mix, so a founder can build "audit +
 * implementation + platform + AI usage + enterprise support" by clicking
 * instead of by knowing which stream kind each piece maps to.
 */
export const REVENUE_STREAM_PRESETS: Array<{ name: string; kind: RevenueStreamKind }> = [
  { name: "Audit", kind: "one_time" },
  { name: "Implementation", kind: "one_time" },
  { name: "Platform subscription", kind: "recurring" },
  { name: "AI usage", kind: "usage" },
  { name: "Enterprise support", kind: "recurring" },
  { name: "Transaction fee", kind: "transactional" },
];

export const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = Object.fromEntries(
  BUSINESS_MODEL_OPTIONS.map((o) => [o.value, o.label])
) as Record<BusinessModel, string>;

export const CURRENCY_LABELS: Record<Currency, string> = Object.fromEntries(
  CURRENCY_OPTIONS.map((o) => [o.value, o.label])
) as Record<Currency, string>;

/**
 * Approximate currency -> USD conversion rates, used only to normalize market-size
 * scoring bands (see scoring/market.ts) so a project priced in a stronger or weaker
 * currency isn't scored against USD-scale anchors as if it were USD. Not intended for
 * display or financial precision — static approximations, review periodically.
 */
export const CURRENCY_TO_USD: Record<Currency, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  AED: 0.272,
  SAR: 0.267,
  OMR: 2.6,
};

export const BILLING_PERIOD_LABELS: Record<BillingPeriod, string> = Object.fromEntries(
  BILLING_PERIOD_OPTIONS.map((o) => [o.value, o.label])
) as Record<BillingPeriod, string>;

export const FUNDING_ROUND_OPTIONS: Array<{ value: FundingRoundType; label: string }> = [
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b_plus", label: "Series B+" },
  { value: "bridge", label: "Bridge" },
];

export const FUNDING_ROUND_LABELS: Record<FundingRoundType, string> = Object.fromEntries(
  FUNDING_ROUND_OPTIONS.map((o) => [o.value, o.label])
) as Record<FundingRoundType, string>;
