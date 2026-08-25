import type { CalculatedMetrics, Insight, Project } from "@/types";
import { normalizeToMonthlyArpu, pct, val } from "@/lib/calculations/helpers";
import { customerLevelMonthlyCost } from "@/lib/calculations/unitEconomics";
import { forecastProject } from "@/lib/calculations/projectForecast";

/**
 * Contradiction Detector — cross-checks assumptions that are entered in
 * different parts of the model and quietly disagree with each other:
 *
 * - `pricing.expectedCustomers12mo` vs the customer count the acquisition
 *   model actually projects at month 12 (the user says "6", the model says 5).
 * - `retention.averageCustomerLifetimeMonths` vs the lifetime the churn rate
 *   implies (a 2% churn and a 48-month lifetime cannot both be right).
 * - `market.averageAnnualCustomerSpend` vs the blended annual revenue per
 *   customer from the full revenue model (or simple pricing fallback).
 * - CAC payback vs customer lifetime (customers who leave before they pay for
 *   their own acquisition — the economics contradict the retention story).
 * - Revenue-stream delivery costs vs the Unit Economics cost lines (the same
 *   infrastructure or support cost counted once inside `deliveryCostPct` and
 *   again per customer).
 *
 * Every rule reads the same derived metrics the rest of the report uses, so
 * the findings are reproducible and auditable — no AI. Messages/details are
 * translation keys with values travelling as params, matching the engine.
 */
export function detectContradictions(project: Project, metrics: CalculatedMetrics): Insight[] {
  const findings: Insight[] = [];

  checkCustomerTrajectory(project, metrics, findings);
  checkLifetimeVsChurn(project, metrics, findings);
  checkTamArpuVsPricing(project, metrics, findings);
  checkPaybackVsLifetime(metrics, findings);
  checkCostDoubleCounting(project, metrics, findings);

  return findings;
}

let idCounter = 0;
function contradiction(
  message: string,
  detail?: string,
  messageParams?: Record<string, string | number>,
  detailParams?: Record<string, string | number>
): Insight {
  idCounter += 1;
  return { id: `contradiction-${idCounter}`, message, messageParams, detail, detailParams };
}

/**
 * Two figures are contradictory when they diverge by more than 15% — wide
 * enough that rounded inputs and the forecast's integer churn rounding never
 * trip it, narrow enough that "6 expected vs 5 projected" still does.
 */
function diverges(a: number, b: number): boolean {
  const relative = Math.abs(a - b) / Math.max(a, b, 1);
  return relative > 0.15;
}

export const TAM_REVENUE_DIFFERENCE_THRESHOLDS_PCT = {
  informational: 20,
  contradiction: 35,
} as const;

/**
 * expectedCustomers12mo vs what the forecast actually produces. The forecast
 * is the same engine that drives the report's projections — it compounds the
 * acquisition rate at the growth rate and subtracts churn, so the gap between
 * its month-12 count and the founder's target is a real contradiction, not a
 * difference in rounding. Skipped when either side was never modeled.
 */
function checkCustomerTrajectory(project: Project, metrics: CalculatedMetrics, findings: Insight[]): void {
  const target = project.pricing.expectedCustomers12mo;
  if (!target || target.quality === "unknown" || val(target) <= 0) return;
  const acquired = project.acquisition.newCustomersAcquiredMonthly;
  if (!acquired || acquired.quality === "unknown" || val(acquired) <= 0) return;

  const forecast = forecastProject(project, metrics, 12);
  const implied = forecast.length >= 12 ? forecast[11].endingCustomers : null;
  // implied === 0 is still a finding: the model churns away the whole base
  // while the founder expects customers.
  if (implied === null) return;

  const expected = val(target);
  if (!diverges(expected, implied)) return;

  findings.push(
    contradiction(
      "Expected customer count contradicts the acquisition model.",
      "{expected} customers are expected in 12 months, but the acquisition model projects {implied}.",
      undefined,
      { expected: Math.round(expected), implied: Math.round(implied) }
    )
  );
}

/**
 * An entered customer-lifetime override vs the lifetime the churn rate
 * implies (1 / monthly churn). Both live on the same screen — the retention
 * section derives one from the other — so an override that disagrees is a
 * sign the founder changed one number without noticing the other.
 */
function checkLifetimeVsChurn(project: Project, metrics: CalculatedMetrics, findings: Insight[]): void {
  const entered = project.retention.averageCustomerLifetimeMonths;
  if (!entered || entered.quality === "unknown" || val(entered) <= 0) return;
  const churnPct = metrics.retention.monthlyChurnPct;
  // Churn of zero means an indefinite lifetime — nothing to contradict.
  if (churnPct <= 0) return;
  // The metrics module prefers an entered override, so the churn-implied
  // lifetime has to be derived here: 1 / monthly churn rate.
  const implied = 100 / churnPct;

  const lifetime = val(entered);
  if (!diverges(lifetime, implied)) return;

  findings.push(
    contradiction(
      "Customer lifetime contradicts the churn assumption.",
      "Lifetime is entered as {entered} months, but {churn}% monthly churn implies {implied} months.",
      undefined,
      {
        entered: lifetime.toFixed(1),
        churn: churnPct.toFixed(1),
        implied: implied.toFixed(1),
      }
    )
  );
}

/**
 * The market sizing builds TAM on `averageAnnualCustomerSpend`; the financial
 * model values the same customer using every active revenue stream. Recurring
 * streams are annualized after billing-period normalization; one-time streams
 * are counted once, including their expected units and attach rate. The simple
 * product price is only a fallback when no stream carries valid price data.
 * Marketplace take rates are excluded: there the platform's cut is *supposed*
 * to be a fraction of what customers spend.
 */
function checkTamArpuVsPricing(project: Project, metrics: CalculatedMetrics, findings: Insight[]): void {
  if (metrics.marketplace !== null) return;

  const spend = project.market.averageAnnualCustomerSpend;
  if (!spend || spend.quality === "unknown" || val(spend) <= 0) return;

  const mix = metrics.revenueMix;
  const modelAnnual = mix
    ? mix.blendedAnnualRevenuePerCustomer
    : project.pricing.billingPeriod === "one_time"
      ? val(project.pricing.productPrice)
      : normalizeToMonthlyArpu(val(project.pricing.productPrice), project.pricing.billingPeriod) * 12;
  if (modelAnnual <= 0) return;

  const marketAnnual = val(spend);
  const differencePct = (Math.abs(marketAnnual - modelAnnual) / modelAnnual) * 100;
  if (differencePct < TAM_REVENUE_DIFFERENCE_THRESHOLDS_PCT.contradiction) return;

  findings.push(
    contradiction(
      "TAM revenue per customer may be inconsistent with the revenue model.",
      "Market sizing assumes {currency} {tam, number} per customer per year, while the expected blended revenue model implies approximately {currency} {model, number} per customer per year.",
      undefined,
      { currency: project.basicInfo.currency, tam: marketAnnual, model: modelAnnual }
    )
  );
}

/**
 * Payback longer than lifetime means a customer leaves before contributing
 * enough gross profit to repay what it cost to win them — the acquisition
 * math and the retention math cannot both hold.
 */
function checkPaybackVsLifetime(metrics: CalculatedMetrics, findings: Insight[]): void {
  const payback = metrics.unitEconomics.cacPaybackMonths;
  const lifetime = metrics.retention.customerLifetimeMonths;
  if (payback === null || payback <= 0 || lifetime === null || lifetime <= 0) return;
  if (payback <= lifetime) return;

  findings.push(
    contradiction(
      "Customers churn before paying back acquisition cost.",
      "Payback takes {payback} months, but customers stay only {lifetime} months.",
      undefined,
      { payback: payback.toFixed(1), lifetime: lifetime.toFixed(1) }
    )
  );
}

/**
 * Cost double-counting. A stream's `deliveryCostPct` is meant to cover only
 * what it costs to deliver *that* stream; the Unit Economics lines are
 * customer-level costs charged on top. Nothing stops a founder from putting
 * infrastructure and support inside a 45% pilot delivery cost and then
 * entering them again per customer — which silently halves the contribution
 * margin and can drive LTV and break-even negative.
 *
 * Only material overlaps are reported. Every additive project has *some*
 * customer-level cost, so a 2%-of-ARPU support line is not a finding; a stack
 * heavy enough to move the answer is. The two triggers are a non-positive
 * recurring contribution (the failure the user actually sees) and
 * customer-level costs worth 15%+ of recurring ARPU (the same threshold the
 * other rules use for "these two numbers disagree").
 */
function checkCostDoubleCounting(project: Project, metrics: CalculatedMetrics, findings: Insight[]): void {
  const mix = metrics.revenueMix;
  if (!mix) return;

  // Only streams the founder actually costed can be double-counting anything.
  const costedStreams = (project.revenueStreams ?? []).filter(
    (stream) => stream.deliveryCostPct.quality !== "unknown" && val(stream.deliveryCostPct) > 0
  );
  if (costedStreams.length === 0) return;

  const answered = [
    project.unitEconomics.directCostPerCustomer,
    project.unitEconomics.infrastructureCostPerCustomer,
    project.unitEconomics.supportCostPerCustomer,
    project.unitEconomics.otherVariableCostPerCustomer,
  ].filter((cost) => cost.quality !== "unknown" && val(cost) > 0);
  if (answered.length === 0) return;

  const customerLevelCost = customerLevelMonthlyCost(project.unitEconomics);
  const recurringContribution = metrics.unitEconomics.recurringGrossProfitPerCustomer;
  const costShareOfArpu = mix.recurringArpu > 0 ? customerLevelCost / mix.recurringArpu : 1;
  if (recurringContribution > 0 && costShareOfArpu <= 0.15) return;

  const processingPct = val(project.unitEconomics.paymentProcessingPct);
  const stackedCost = customerLevelCost + mix.recurringArpu * pct(processingPct);

  findings.push(
    contradiction(
      "Potential cost double-counting between revenue streams and unit economics.",
      "Revenue streams already carry their own delivery cost, and a further {currency} {stacked, number} per customer per month of direct, infrastructure and support cost is charged on top. Remove whichever side already accounts for it.",
      undefined,
      {
        currency: project.basicInfo.currency,
        stacked: Math.round(stackedCost * 100) / 100,
      }
    )
  );
}
