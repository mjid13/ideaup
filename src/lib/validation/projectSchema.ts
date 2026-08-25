import { z } from "zod";
import { pitchCompetitorSchema, pitchRoundDetailsSchema, pitchTeamMemberSchema, tractionDataPointSchema } from "./pitchDeckSchema";
import {
  onePagerSchema,
  icpSchema,
  valuePropSchema,
  validationPlanSchema,
  mvpScopeSchema,
  gtmPlanSchema,
  salesDocsSchema,
  contractTermsSchema,
  pilotReportSchema,
} from "./businessDocumentsSchema";

const dataQualitySchema = z.enum(["known", "estimated", "unknown"]);

const assumptionRangeSchema = z.object({
  low: z.number().finite("Must be a finite number"),
  high: z.number().finite("Must be a finite number"),
});

// React Hook Form cannot use `undefined` to explicitly clear a controlled field:
// it reads that as "use the default value". The range toggle therefore uses
// `null` as a form-only cleared value, which is normalized here so the domain
// model and persisted project continue to represent a single number by omitting
// `range` entirely.
type OptionalAssumptionRange = z.infer<typeof assumptionRangeSchema> | undefined;
const optionalAssumptionRangeSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  assumptionRangeSchema.optional()
) as z.ZodType<OptionalAssumptionRange, OptionalAssumptionRange>;

const assumptionSchema = z
  .object({
    value: z.number().finite("Must be a finite number"),
    quality: dataQualitySchema,
    // Optional — absent means a single point estimate. Present means `value` is
    // the most likely point inside [low, high].
    range: optionalAssumptionRangeSchema.optional(),
  })
  .refine((a) => !a.range || a.range.low <= a.range.high, {
    message: "The low end must not exceed the high end",
    path: ["range", "low"],
  })
  .refine((a) => !a.range || (a.value >= a.range.low && a.value <= a.range.high), {
    message: "The most likely value must sit inside the range",
    path: ["value"],
  });

const optionalAssumptionSchema = assumptionSchema.optional();

const nonNegativeAssumption = assumptionSchema
  .refine((a) => a.quality === "unknown" || a.value >= 0, {
    message: "Must be zero or greater",
  })
  .refine((a) => !a.range || a.range.low >= 0, {
    message: "Must be zero or greater",
    path: ["range", "low"],
  });

export const basicInfoSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string(),
  businessModel: z.enum(["saas", "subscription", "marketplace", "ecommerce", "one_time", "service", "usage_based", "other"]),
  currency: z.enum(["OMR", "USD", "SAR", "AED", "EUR", "GBP"]),
});

export const marketFunnelStageSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    mode: z.enum(["count", "percent"]),
    value: nonNegativeAssumption,
    note: z.string().optional(),
  })
  .refine((s) => s.mode !== "percent" || s.value.quality === "unknown" || s.value.value <= 100, {
    message: "A survival percentage cannot exceed 100",
    path: ["value", "value"],
  });

export const marketFunnelSchema = z.object({
  baseLabel: z.string(),
  baseCount: nonNegativeAssumption,
  stages: z.array(marketFunnelStageSchema),
  samStageId: z.string().optional(),
  somStageId: z.string().optional(),
  winRatePct: assumptionSchema,
});

export const marketSchema = z.object({
  totalPotentialCustomers: nonNegativeAssumption,
  averageAnnualCustomerSpend: nonNegativeAssumption,
  addressableMarketPct: assumptionSchema,
  obtainableMarketPct: assumptionSchema,
  tamOverride: z.number().optional(),
  samOverride: z.number().optional(),
  somOverride: z.number().optional(),
  sizingMethod: z.enum(["simple", "funnel", "direct"]).optional(),
  funnel: marketFunnelSchema.optional(),
  targetCustomers: nonNegativeAssumption,
});

export const pricingSchema = z.object({
  productPrice: nonNegativeAssumption,
  billingPeriod: z.enum(["monthly", "quarterly", "annual", "one_time", "usage_based"]),
  currentCustomers: nonNegativeAssumption,
  expectedCustomers12mo: nonNegativeAssumption,
  expectedMonthlyCustomerGrowthPct: assumptionSchema,
  freeToPaidConversionPct: optionalAssumptionSchema,
  topCustomersRevenueSharePct: optionalAssumptionSchema,
});

/**
 * Hybrid revenue mix. Optional and array-shaped: a business is not one of SaaS
 * *or* services *or* usage — it can be all of them at once, and each stream
 * carries its own price basis and delivery margin.
 */
export const revenueStreamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Stream name is required"),
  kind: z.enum(["one_time", "recurring", "usage", "transactional"]),
  price: nonNegativeAssumption,
  billingPeriod: z.enum(["monthly", "quarterly", "annual", "one_time", "usage_based"]),
  attachRatePct: assumptionSchema,
  unitsPerCustomerPerMonth: nonNegativeAssumption,
  takeRatePct: optionalAssumptionSchema,
  deliveryCostPct: assumptionSchema,
});

export const marketplaceSchema = z.object({
  averageOrderValue: nonNegativeAssumption,
  takeRatePct: assumptionSchema,
  transactionsPerCustomerPerMonth: nonNegativeAssumption,
});

export const acquisitionSchema = z.object({
  monthlyMarketingSpend: nonNegativeAssumption,
  monthlySalesSpend: nonNegativeAssumption,
  newCustomersAcquiredMonthly: nonNegativeAssumption,
  monthlyLeads: optionalAssumptionSchema,
  leadToCustomerConversionPct: optionalAssumptionSchema,
});

export const retentionSchema = z.object({
  monthlyChurnPct: assumptionSchema,
  annualChurnPct: optionalAssumptionSchema,
  averageCustomerLifetimeMonths: optionalAssumptionSchema,
  monthlyExpansionRevenuePct: optionalAssumptionSchema,
  monthlyContractionRevenuePct: optionalAssumptionSchema,
});

export const unitEconomicsSchema = z.object({
  revenuePerCustomer: nonNegativeAssumption,
  directCostPerCustomer: nonNegativeAssumption,
  paymentProcessingPct: assumptionSchema,
  infrastructureCostPerCustomer: nonNegativeAssumption,
  supportCostPerCustomer: nonNegativeAssumption,
  otherVariableCostPerCustomer: nonNegativeAssumption,
});

export const costsSchema = z.object({
  founderSalaries: nonNegativeAssumption,
  employeeSalaries: nonNegativeAssumption,
  contractorExpenses: nonNegativeAssumption,
  officeExpenses: nonNegativeAssumption,
  infrastructure: nonNegativeAssumption,
  softwareSubscriptions: nonNegativeAssumption,
  marketing: nonNegativeAssumption,
  sales: nonNegativeAssumption,
  legalAccounting: nonNegativeAssumption,
  otherMonthlyExpenses: nonNegativeAssumption,
});

export const fundingSchema = z.object({
  availableCash: nonNegativeAssumption,
  initialInvestment: nonNegativeAssumption,
  otherMonthlyIncome: nonNegativeAssumption,
  preMoneyValuation: optionalAssumptionSchema,
  // Funding requirement inputs — optional so projects saved before the
  // requirement calculator existed still parse; the calculator falls back to
  // documented defaults for anything absent.
  monthsToMilestone: optionalAssumptionSchema,
  safetyBufferMonths: optionalAssumptionSchema,
  receivableDays: optionalAssumptionSchema,
  capex: optionalAssumptionSchema,
  contingencyPct: optionalAssumptionSchema,
});

/**
 * Debt-financing inputs (Lender Mode). Every numeric field is optional so
 * projects saved before Lender Mode existed still parse — `calculateLenderMetrics`
 * falls back to documented defaults (60-month term, 1.25x target DSCR, 30%
 * downside haircut) for anything absent.
 */
export const debtSchema = z.object({
  loanAmount: optionalAssumptionSchema,
  annualInterestRatePct: optionalAssumptionSchema,
  termMonths: optionalAssumptionSchema,
  gracePeriodMonths: optionalAssumptionSchema,
  existingMonthlyDebtService: optionalAssumptionSchema,
  founderContribution: optionalAssumptionSchema,
  collateralValue: optionalAssumptionSchema,
  collateralDescription: z.string().optional(),
  personalGuarantee: z.boolean().optional(),
  contractedMonthlyRevenue: optionalAssumptionSchema,
  targetDscr: optionalAssumptionSchema,
  downsideRevenueHaircutPct: optionalAssumptionSchema,
});

export type DebtFormValues = z.infer<typeof debtSchema>;

const rating = z.number().min(1).max(5);

export const validationAssessmentSchema = z.object({
  problemPain: rating,
  problemFrequency: rating,
  problemAlreadySpendingMoney: rating,
  customersInterviewed: rating,
  hasUsers: rating,
  hasPayingCustomers: rating,
  hasSignedLois: rating,
  customersRequestedSolution: rating,
  technicallyFeasible: rating,
  mvpDifficulty: rating,
  productDifferentiation: rating,
  knowsHowToReachCustomers: rating,
  hasAudience: rating,
  hasPartnerships: rating,
  hasUnfairDistributionAdvantage: rating,
  competitionIntensity: rating,
  differentiationStrength: rating,
  switchingEase: rating,
});

export const teamAssessmentSchema = z.object({
  domainExpertise: rating,
  technicalAbility: rating,
  salesCapability: rating,
  marketingCapability: rating,
  founderCommitment: rating,
  industryRelationships: rating,
  accessToCapital: rating,
});

export const riskAssessmentSchema = z.object({
  technicalRisk: rating,
  marketRisk: rating,
  regulatoryRisk: rating,
  competitiveRisk: rating,
  financialRisk: rating,
  dependencyRisk: rating,
});

export const pitchSchema = z.object({
  problemStatement: z.string(),
  competitiveLandscape: z.string(),
  traction: z.string(),
  teamBios: z.string(),
  vision: z.string(),
  fundingAsk: assumptionSchema,
  useOfFunds: z.string(),
  tractionHistory: z.array(tractionDataPointSchema).optional(),
  teamMembers: z.array(pitchTeamMemberSchema).optional(),
  competitors: z.array(pitchCompetitorSchema).optional(),
  round: pitchRoundDetailsSchema.optional(),
});

export const projectFormSchema = z.object({
  basicInfo: basicInfoSchema,
  market: marketSchema,
  pricing: pricingSchema,
  revenueStreams: z.array(revenueStreamSchema).max(12).optional(),
  marketplace: marketplaceSchema.optional(),
  acquisition: acquisitionSchema,
  retention: retentionSchema,
  unitEconomics: unitEconomicsSchema,
  costs: costsSchema,
  funding: fundingSchema,
  // Optional — Lender Mode inputs, absent on projects saved before it existed.
  debt: debtSchema.optional(),
  validation: validationAssessmentSchema,
  team: teamAssessmentSchema,
  risk: riskAssessmentSchema,
  pitch: pitchSchema,
  // Business-building documents (post-viability-report). Optional — unlike
  // `pitch`, which every project has had since creation — so parsing never
  // throws for rows saved before this feature existed.
  onePager: onePagerSchema.optional(),
  icp: icpSchema.optional(),
  valueProp: valuePropSchema.optional(),
  validationPlan: validationPlanSchema.optional(),
  mvpScope: mvpScopeSchema.optional(),
  gtmPlan: gtmPlanSchema.optional(),
  salesDocs: salesDocsSchema.optional(),
  contractTerms: contractTermsSchema.optional(),
  pilotReport: pilotReportSchema.optional(),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

export const projectDocumentSchema = projectFormSchema.extend({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive().default(1),
  revision: z.number().int().positive().default(1),
  // PostgreSQL/PostgREST serializes `timestamptz` values with a numeric UTC
  // offset (for example, `+00:00`) rather than the trailing `Z` produced by
  // Date#toISOString. Both forms are valid ISO 8601 timestamps.
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

/** Field paths (dot notation) that belong to each wizard step, used for per-step validation via RHF's trigger(). */
export const STEP_FIELDS: Record<string, string[]> = {
  basicInfo: ["basicInfo"],
  market: ["market"],
  pricing: ["pricing"],
  revenueStreams: ["revenueStreams"],
  marketplace: ["marketplace"],
  acquisition: ["acquisition"],
  retention: ["retention"],
  unitEconomics: ["unitEconomics"],
  costs: ["costs"],
  funding: ["funding"],
  validation: ["validation"],
  team: ["team"],
  risk: ["risk"],
  pitch: ["pitch"],
};
