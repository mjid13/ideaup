import { describe, expect, it } from "vitest";
import { detectContradictions } from "../contradictions";
import { calculateMetrics } from "@/lib/calculations/metrics";
import { createEmptyProject } from "@/lib/storage/factory";
import { exampleProject } from "@/lib/example";
import { known, type Project, type RevenueStream } from "@/types";

function contradictionsFor(project: Project): ReturnType<typeof detectContradictions> {
  return detectContradictions(project, calculateMetrics(project));
}

const tamMessage = "TAM revenue per customer may be inconsistent with the revenue model.";

function tamFinding(project: Project) {
  return contradictionsFor(project).find((insight) => insight.message === tamMessage);
}

function revenueStream(
  overrides: Partial<RevenueStream> & Pick<RevenueStream, "id" | "kind" | "price">
): RevenueStream {
  return {
    name: overrides.id,
    billingPeriod: overrides.kind === "one_time" ? "one_time" : "monthly",
    attachRatePct: known(100),
    unitsPerCustomerPerMonth: known(1),
    deliveryCostPct: known(0),
    ...overrides,
  };
}

describe("detectContradictions", () => {
  it("flags expected customers that disagree with the acquisition model", () => {
    // 0.42 customers/month x 12 = ~5, but the founder expects 6.
    const project: Project = {
      ...exampleProject,
      pricing: {
        ...exampleProject.pricing,
        currentCustomers: known(0),
        expectedCustomers12mo: known(6),
        expectedMonthlyCustomerGrowthPct: known(0),
      },
      acquisition: { ...exampleProject.acquisition, newCustomersAcquiredMonthly: known(0.42) },
      retention: { ...exampleProject.retention, monthlyChurnPct: known(0) },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Expected customer count contradicts the acquisition model.")).toBe(true);
    expect(report.some((i) => i.detailParams?.expected === 6)).toBe(true);
  });

  it("stays silent when expected customers match the model projection", () => {
    const project: Project = {
      ...exampleProject,
      pricing: {
        ...exampleProject.pricing,
        currentCustomers: known(0),
        expectedCustomers12mo: known(12),
        expectedMonthlyCustomerGrowthPct: known(0),
      },
      acquisition: { ...exampleProject.acquisition, newCustomersAcquiredMonthly: known(1) },
      retention: { ...exampleProject.retention, monthlyChurnPct: known(0) },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Expected customer count contradicts the acquisition model.")).toBe(false);
  });

  it("skips the trajectory check when acquisition was never modeled", () => {
    const project: Project = {
      ...exampleProject,
      pricing: { ...exampleProject.pricing, expectedCustomers12mo: known(100) },
      acquisition: { ...exampleProject.acquisition, newCustomersAcquiredMonthly: known(0) },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Expected customer count contradicts the acquisition model.")).toBe(false);
  });

  it("flags an entered customer lifetime that contradicts the churn rate", () => {
    // 48 months implies ~2% churn; an 8% churn implies 12.5 months.
    const project: Project = {
      ...exampleProject,
      retention: {
        ...exampleProject.retention,
        monthlyChurnPct: known(8),
        averageCustomerLifetimeMonths: known(48),
      },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Customer lifetime contradicts the churn assumption.")).toBe(true);
    expect(report.some((i) => i.detailParams?.implied === "12.5")).toBe(true);
  });

  it("accepts a lifetime that matches the churn-implied value", () => {
    // 2% churn implies 50 months — a 48-month override is within tolerance.
    const project: Project = {
      ...exampleProject,
      retention: {
        ...exampleProject.retention,
        monthlyChurnPct: known(2),
        averageCustomerLifetimeMonths: known(48),
      },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Customer lifetime contradicts the churn assumption.")).toBe(false);
  });

  it("uses the fallback monthly product price when no revenue streams exist", () => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(1800) },
      pricing: { ...exampleProject.pricing, productPrice: known(100), billingPeriod: "monthly" },
    };
    const finding = tamFinding(project);
    expect(finding).toBeDefined();
    expect(finding?.detailParams?.model).toBe(1200);
  });

  it("accepts a TAM spend aligned with the pricing model", () => {
    // $50/mo x 12 = $600/yr — the example's TAM uses exactly that.
    expect(tamFinding(exampleProject)).toBeUndefined();
  });

  it("does not flag the TAM check for marketplace models (take rate is a fraction)", () => {
    const project: Project = {
      ...exampleProject,
      basicInfo: { ...exampleProject.basicInfo, businessModel: "marketplace" },
      marketplace: {
        averageOrderValue: known(100),
        takeRatePct: known(10),
        transactionsPerCustomerPerMonth: known(2),
      },
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(24000) },
    };
    expect(tamFinding(project)).toBeUndefined();
  });

  it("flags customers that churn before paying back acquisition cost", () => {
    const project: Project = {
      ...exampleProject,
      acquisition: { ...exampleProject.acquisition, monthlyMarketingSpend: known(5000), newCustomersAcquiredMonthly: known(1) },
      retention: { ...exampleProject.retention, monthlyChurnPct: known(2) },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Customers churn before paying back acquisition cost.")).toBe(true);
  });

  it("stays silent when payback fits inside customer lifetime", () => {
    const report = contradictionsFor(exampleProject);
    expect(report.some((i) => i.message === "Customers churn before paying back acquisition cost.")).toBe(false);
  });

  it("returns nothing on a pristine project without crashing", () => {
    const empty = createEmptyProject();
    expect(contradictionsFor(empty)).toEqual([]);
  });

  it("flags the trajectory when churn collapses the base the model projects", () => {
    // 100% churn eats every cohort; the model ends at 1 while 50 are expected.
    const project: Project = {
      ...exampleProject,
      pricing: {
        ...exampleProject.pricing,
        currentCustomers: known(0),
        expectedCustomers12mo: known(50),
        expectedMonthlyCustomerGrowthPct: known(0),
      },
      acquisition: { ...exampleProject.acquisition, newCustomersAcquiredMonthly: known(1) },
      retention: { ...exampleProject.retention, monthlyChurnPct: known(100) },
    };
    const report = contradictionsFor(project);
    expect(report.some((i) => i.message === "Expected customer count contradicts the acquisition model.")).toBe(true);
  });

  it("normalizes annual billing before comparing TAM spend to pricing", () => {
    // $600/yr price == $600/yr market spend — no contradiction.
    const project: Project = {
      ...exampleProject,
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(600) },
      pricing: { ...exampleProject.pricing, productPrice: known(600), billingPeriod: "annual" },
    };
    expect(tamFinding(project)).toBeUndefined();
  });

  it("annualizes a single monthly subscription", () => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [revenueStream({ id: "platform", kind: "recurring", price: known(100) })],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(1800) },
    };
    expect(tamFinding(project)?.detailParams?.model).toBe(1200);
  });

  it("blends multiple recurring streams across billing periods", () => {
    const project: Project = {
      ...exampleProject,
      pricing: { ...exampleProject.pricing, productPrice: known(10) },
      revenueStreams: [
        revenueStream({ id: "monthly", kind: "recurring", price: known(100) }),
        revenueStream({ id: "quarterly", kind: "recurring", price: known(300), billingPeriod: "quarterly" }),
        revenueStream({ id: "annual", kind: "recurring", price: known(1200), billingPeriod: "annual" }),
      ],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(3600) },
    };
    expect(calculateMetrics(project).revenueMix?.blendedAnnualRevenuePerCustomer).toBe(3600);
    expect(tamFinding(project)).toBeUndefined();
  });

  it("adds recurring and one-time revenue without annualizing one-time purchases", () => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [
        revenueStream({ id: "subscription", kind: "recurring", price: known(100) }),
        revenueStream({
          id: "implementation",
          kind: "one_time",
          price: known(600),
          unitsPerCustomerPerMonth: known(2),
          attachRatePct: known(50),
        }),
      ],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(1800) },
    };
    expect(calculateMetrics(project).revenueMix?.blendedAnnualRevenuePerCustomer).toBe(1800);
    expect(tamFinding(project)).toBeUndefined();
  });

  it("applies attach rates below 100% to each stream", () => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [
        revenueStream({ id: "subscription", kind: "recurring", price: known(200), attachRatePct: known(25) }),
        revenueStream({
          id: "assessment",
          kind: "one_time",
          price: known(1000),
          unitsPerCustomerPerMonth: known(2),
          attachRatePct: known(50),
        }),
      ],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(1600) },
    };
    expect(calculateMetrics(project).revenueMix?.blendedAnnualRevenuePerCustomer).toBe(1600);
    expect(tamFinding(project)).toBeUndefined();
  });

  it.each([
    { label: "below 20%", marketAnnual: 1199 },
    { label: "between 20% and 35%", marketAnnual: 1250 },
    { label: "just below 35%", marketAnnual: 1349 },
  ])("does not warn when the difference is $label", ({ marketAnnual }) => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [revenueStream({ id: "implementation", kind: "one_time", price: known(1000) })],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(marketAnnual) },
    };
    expect(tamFinding(project)).toBeUndefined();
  });

  it("warns at a difference of 35% or more and explains the comparison", () => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [revenueStream({ id: "implementation", kind: "one_time", price: known(1000) })],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(1350) },
    };
    const finding = tamFinding(project);
    expect(finding).toBeDefined();
    expect(finding?.detailParams).toMatchObject({ tam: 1350, model: 1000 });
    expect(finding?.detail).toContain("expected blended revenue model");
  });

  it("does not give a Ramz-style hybrid model a false warning from productPrice x 12", () => {
    const project: Project = {
      ...exampleProject,
      basicInfo: { ...exampleProject.basicInfo, currency: "OMR" },
      pricing: { ...exampleProject.pricing, productPrice: known(25), billingPeriod: "monthly" },
      revenueStreams: [
        revenueStream({ id: "platform", kind: "recurring", price: known(250) }),
        revenueStream({ id: "support", kind: "recurring", price: known(100), attachRatePct: known(50) }),
        revenueStream({ id: "implementation", kind: "one_time", price: known(2400) }),
      ],
      market: { ...exampleProject.market, averageAnnualCustomerSpend: known(6000) },
    };
    expect(calculateMetrics(project).revenueMix?.blendedAnnualRevenuePerCustomer).toBe(6000);
    expect(tamFinding(project)).toBeUndefined();
  });
});

describe("cost double-counting", () => {
  function platformStream(deliveryCostPct: number): RevenueStream {
    return {
      id: "s1",
      name: "Platform",
      kind: "recurring",
      price: known(1000),
      billingPeriod: "monthly",
      attachRatePct: known(100),
      unitsPerCustomerPerMonth: known(1),
      deliveryCostPct: known(deliveryCostPct),
    };
  }

  function projectWith(deliveryCostPct: number, customerCosts: Partial<Project["unitEconomics"]>): Project {
    return {
      ...exampleProject,
      revenueStreams: [platformStream(deliveryCostPct)],
      unitEconomics: {
        ...exampleProject.unitEconomics,
        directCostPerCustomer: known(0),
        infrastructureCostPerCustomer: known(0),
        supportCostPerCustomer: known(0),
        otherVariableCostPerCustomer: known(0),
        paymentProcessingPct: known(0),
        ...customerCosts,
      },
    };
  }

  const message = "Potential cost double-counting between revenue streams and unit economics.";

  it("flags customer-level costs stacked on top of a costed stream", () => {
    // A 45% delivery cost that plausibly already covers infrastructure and
    // support, with $400 of the same costs charged again per customer.
    const report = contradictionsFor(
      projectWith(45, { infrastructureCostPerCustomer: known(250), supportCostPerCustomer: known(150) })
    );
    const finding = report.find((i) => i.message === message);
    expect(finding).toBeDefined();
    expect(finding?.detailParams?.stacked).toBe(400);
  });

  it("stays silent when the stream carries no delivery cost of its own", () => {
    const report = contradictionsFor(
      projectWith(0, { infrastructureCostPerCustomer: known(250), supportCostPerCustomer: known(150) })
    );
    expect(report.some((i) => i.message === message)).toBe(false);
  });

  it("stays silent when no customer-level cost was entered", () => {
    expect(contradictionsFor(projectWith(45, {})).some((i) => i.message === message)).toBe(false);
  });

  it("ignores an immaterial customer-level cost", () => {
    // $20 against a $1,000 ARPU is 2% — a real cost, not a duplicated one.
    const report = contradictionsFor(projectWith(45, { supportCostPerCustomer: known(20) }));
    expect(report.some((i) => i.message === message)).toBe(false);
  });

  it("flags a small cost once it drives recurring contribution negative", () => {
    // A 99% delivery cost leaves $10 of margin; $20 of support wipes it out.
    const report = contradictionsFor(projectWith(99, { supportCostPerCustomer: known(20) }));
    expect(report.some((i) => i.message === message)).toBe(true);
  });

  it("never fires on the single-price model, which has no stream costs to overlap", () => {
    const project: Project = {
      ...exampleProject,
      revenueStreams: [],
      unitEconomics: { ...exampleProject.unitEconomics, supportCostPerCustomer: known(500) },
    };
    expect(contradictionsFor(project).some((i) => i.message === message)).toBe(false);
  });
});
