// Domain model types for IdeaUp.
// Kept free of any UI or persistence concerns so they can be reused by the
// calculation engine, scoring engine, insight engine, and presentation layer.

export type Currency = "OMR" | "USD" | "SAR" | "AED" | "EUR" | "GBP";

export type BusinessModel =
  | "saas"
  | "subscription"
  | "marketplace"
  | "ecommerce"
  | "one_time"
  | "service"
  | "usage_based"
  | "other";

export type BillingPeriod = "monthly" | "quarterly" | "annual" | "one_time" | "usage_based";

/** Marks whether an input represents a real, estimated, or missing value. */
export type DataQuality = "known" | "estimated" | "unknown";

/**
 * Plausible span for a numeric assumption. Paired with the assumption's own
 * `value`, which is read as the most likely point inside the span, it turns a
 * falsely precise "CAC = 4,000" into "CAC is 2,500-5,000, most likely 4,000"
 * and gives the Monte Carlo engine something to sample.
 */
export interface AssumptionRange {
  low: number;
  high: number;
}

/** A single numeric input paired with metadata about how reliable it is. */
export interface Assumption<T = number> {
  /** Single number, or the most likely value when `range` is present. */
  value: T;
  quality: DataQuality;
  /** Optional low/high span. Absent means the input is a single point estimate. */
  range?: AssumptionRange;
}

export function known<T>(value: T): Assumption<T> {
  return { value, quality: "known" };
}

export function estimated<T>(value: T): Assumption<T> {
  return { value, quality: "estimated" };
}

export function unknownValue<T>(fallback: T): Assumption<T> {
  return { value: fallback, quality: "unknown" };
}

/** An estimated assumption expressed as low / most likely / high. */
export function ranged(low: number, likely: number, high: number, quality: DataQuality = "estimated"): Assumption<number> {
  return { value: likely, quality, range: { low, high } };
}

/** True when the assumption carries a usable (non-degenerate) low/high span. */
export function hasRange(a: Assumption<number> | undefined | null): a is Assumption<number> & { range: AssumptionRange } {
  const r = a?.range;
  return !!r && Number.isFinite(r.low) && Number.isFinite(r.high) && r.high > r.low;
}

// ---------------------------------------------------------------------------
// Basic information
// ---------------------------------------------------------------------------

export interface BasicInfo {
  name: string;
  description: string;
  businessModel: BusinessModel;
  currency: Currency;
}

// ---------------------------------------------------------------------------
// Step 1 - Market
// ---------------------------------------------------------------------------

/**
 * How TAM/SAM/SOM are derived:
 * - "simple"  — customers x spend, then two percentage haircuts (the original model).
 * - "funnel"  — a bottom-up qualification funnel that narrows a starting universe
 *               of accounts through successive filters (sector, size, digital
 *               maturity, workflow fit, budget, reachability).
 * - "direct"  — the founder already knows TAM/SAM/SOM and enters them outright.
 */
export type MarketSizingMethod = "simple" | "funnel" | "direct";

/**
 * How a funnel stage's population is expressed: either the absolute number of
 * accounts left after the filter, or the share (0-100) of the previous stage
 * that survives it.
 */
export type FunnelStageMode = "count" | "percent";

export interface MarketFunnelStage {
  /** Stable id — referenced by MarketFunnel.samStageId/somStageId. */
  id: string;
  /** What this filter selects for, e.g. "Digitally ready". */
  label: string;
  mode: FunnelStageMode;
  /** Account count (mode "count") or survival percentage (mode "percent"). */
  value: Assumption<number>;
  /** Where the number came from — a source, a query, a rationale. */
  note?: string;
}

/**
 * A bottom-up account funnel: a starting universe narrowed by ordered filters
 * down to the accounts we can actually sell to. Example:
 * 130,000 SMEs -> 19,880 small/medium -> 6,500 relevant sectors ->
 * 2,300 digitally ready -> 1,400 with budget -> 600 qualified accounts.
 */
export interface MarketFunnel {
  /** Describes the starting universe, e.g. "Registered SMEs in Oman". */
  baseLabel: string;
  /** Size of the starting universe — the population TAM is built on. */
  baseCount: Assumption<number>;
  /** Ordered filters, each applied to the population left by the one before it. */
  stages: MarketFunnelStage[];
  /**
   * Stage whose surviving population defines SAM. Defaults to the
   * second-to-last stage when unset (the last stage then defines SOM).
   */
  samStageId?: string;
  /** Stage whose surviving population defines SOM. Defaults to the last stage. */
  somStageId?: string;
  /**
   * Share (0-100) of the SOM-stage accounts we expect to actually win.
   * Left "unknown" it is treated as 100% — the funnel's final stage is already
   * a qualified-accounts count, so no extra haircut is implied until asked for.
   */
  winRatePct: Assumption<number>;
}

export interface MarketAssumptions {
  /** Total number of potential customers in the wider market. */
  totalPotentialCustomers: Assumption<number>;
  /** Average annual spend per customer in the target category. */
  averageAnnualCustomerSpend: Assumption<number>;
  /** Percentage (0-100) of the total market that is realistically addressable. */
  addressableMarketPct: Assumption<number>;
  /** Percentage (0-100) of the addressable market realistically obtainable. */
  obtainableMarketPct: Assumption<number>;
  /** Optional direct overrides, applied only when sizingMethod is "direct". */
  tamOverride?: number;
  samOverride?: number;
  somOverride?: number;
  /** Absent on projects saved before the funnel existed — treated as "simple". */
  sizingMethod?: MarketSizingMethod;
  /** Bottom-up account funnel, used when sizingMethod is "funnel". */
  funnel?: MarketFunnel;
  /** Customers targeted within the planning horizon, used for penetration. */
  targetCustomers: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 2 - Pricing & customers
// ---------------------------------------------------------------------------

export interface PricingAssumptions {
  productPrice: Assumption<number>;
  billingPeriod: BillingPeriod;
  currentCustomers: Assumption<number>;
  expectedCustomers12mo: Assumption<number>;
  expectedMonthlyCustomerGrowthPct: Assumption<number>;
  freeToPaidConversionPct?: Assumption<number>;
  /** Estimated % of monthly revenue coming from your largest few customers. */
  topCustomersRevenueSharePct?: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 2a - Revenue streams (hybrid economics)
//
// `basicInfo.businessModel` is a label, not an economic straitjacket: real
// companies stack an upfront audit, a paid implementation, a platform
// subscription, metered AI usage, and an enterprise support retainer inside a
// single business. Each of those behaves differently (one-time cash on
// acquisition vs. recurring cash every month, 90% software margin vs. 35%
// services margin), so they are modelled as separate streams and blended,
// rather than collapsed into one price and one margin.
// ---------------------------------------------------------------------------

export type RevenueStreamKind =
  /** Charged once per customer (audit, setup fee, implementation project). */
  | "one_time"
  /** Charged every billing period for as long as the customer stays (platform, support retainer). */
  | "recurring"
  /** Metered consumption billed monthly (AI tokens, API calls, seats-by-usage). */
  | "usage"
  /** A cut of transaction volume flowing through the product (marketplace take rate). */
  | "transactional";

export interface RevenueStream {
  id: string;
  /** Founder-facing label, e.g. "AI audit" or "Enterprise support". */
  name: string;
  kind: RevenueStreamKind;
  /**
   * Price on this stream's own basis: per purchase (`one_time`), per billing
   * period (`recurring`), per billable unit (`usage`), or the average
   * transaction value the take rate applies to (`transactional`).
   */
  price: Assumption<number>;
  /** Only read for `recurring` — normalizes an annual contract into a monthly figure. */
  billingPeriod: BillingPeriod;
  /** % of customers (0-100) who buy this stream. Treated as 100% while still unknown. */
  attachRatePct: Assumption<number>;
  /**
   * `usage`: billable units per attached customer per month.
   * `transactional`: transactions per attached customer per month.
   * `one_time`: purchases per attached customer (1 for a single setup fee).
   * `recurring`: ignored.
   * Treated as 1 while still unknown.
   */
  unitsPerCustomerPerMonth: Assumption<number>;
  /** `transactional` only: % of transaction value kept as revenue. */
  takeRatePct?: Assumption<number>;
  /**
   * Cost of delivering this stream, as a % of its own revenue — the number that
   * separates a 90%-margin platform from a 40%-margin implementation project.
   * Customer-level costs that are not stream-specific stay in
   * `UnitEconomicsAssumptions` and apply on top.
   */
  deliveryCostPct: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 2b - Marketplace GMV & take rate (only applicable to businessModel "marketplace")
// ---------------------------------------------------------------------------

export interface MarketplaceAssumptions {
  averageOrderValue: Assumption<number>;
  takeRatePct: Assumption<number>;
  transactionsPerCustomerPerMonth: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 3 - Customer acquisition
// ---------------------------------------------------------------------------

export interface AcquisitionAssumptions {
  monthlyMarketingSpend: Assumption<number>;
  monthlySalesSpend: Assumption<number>;
  newCustomersAcquiredMonthly: Assumption<number>;
  monthlyLeads?: Assumption<number>;
  leadToCustomerConversionPct?: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 4 - Retention
// ---------------------------------------------------------------------------

export interface RetentionAssumptions {
  monthlyChurnPct: Assumption<number>;
  annualChurnPct?: Assumption<number>;
  averageCustomerLifetimeMonths?: Assumption<number>;
  /** Revenue expansion (upsell/cross-sell) as a % of MRR added each month, from existing customers. */
  monthlyExpansionRevenuePct?: Assumption<number>;
  /** Revenue contraction (downgrades) as a % of MRR lost each month, from existing customers. */
  monthlyContractionRevenuePct?: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 5 - Unit economics
// ---------------------------------------------------------------------------

export interface UnitEconomicsAssumptions {
  revenuePerCustomer: Assumption<number>;
  directCostPerCustomer: Assumption<number>;
  paymentProcessingPct: Assumption<number>;
  infrastructureCostPerCustomer: Assumption<number>;
  supportCostPerCustomer: Assumption<number>;
  otherVariableCostPerCustomer: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 6 - Operating expenses
// ---------------------------------------------------------------------------

export interface CostAssumptions {
  founderSalaries: Assumption<number>;
  employeeSalaries: Assumption<number>;
  contractorExpenses: Assumption<number>;
  officeExpenses: Assumption<number>;
  infrastructure: Assumption<number>;
  softwareSubscriptions: Assumption<number>;
  marketing: Assumption<number>;
  sales: Assumption<number>;
  legalAccounting: Assumption<number>;
  otherMonthlyExpenses: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 7 - Funding & runway
// ---------------------------------------------------------------------------

export interface FundingAssumptions {
  availableCash: Assumption<number>;
  initialInvestment: Assumption<number>;
  otherMonthlyIncome: Assumption<number>;
  /**
   * Pre-money valuation for the round represented by `initialInvestment`. Distinct from
   * the pitch deck's narrative-only `PitchRoundDetails.valuation` (never affects
   * calculations) — this field drives real dilution math.
   */
  preMoneyValuation?: Assumption<number>;
  // -------------------------------------------------------------------------
  // Funding requirement inputs — the founder describes the plan, and the app
  // derives how much financing it needs (`FundingRequirementMetrics`) instead
  // of asking for a raise amount directly.
  // -------------------------------------------------------------------------
  /** Months of operating plan to fund before the next milestone is reached. Defaults to 12 when absent. */
  monthsToMilestone?: Assumption<number>;
  /** Extra months of net burn held back beyond the milestone window. Defaults to 3 when absent. */
  safetyBufferMonths?: Assumption<number>;
  /** Average days between invoicing a customer and collecting cash — drives the working-capital requirement. */
  receivableDays?: Assumption<number>;
  /** One-time capital expenditure (equipment, fit-out, deposits, licenses) the plan must cover. */
  capex?: Assumption<number>;
  /** Percentage added on top of required financing to produce the recommended raise. Defaults to 18 when absent. */
  contingencyPct?: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 7b - Debt financing (Lender Mode)
//
// A bank underwrites a different question than an investor does: not "how big
// can this get" but "can this service the loan every month, and what happens
// when it doesn't". These inputs exist only for that question — absence never
// affects viability scoring or the investor view.
// ---------------------------------------------------------------------------

export interface DebtAssumptions {
  /**
   * Principal being requested. Left unknown, Lender Mode sizes it from the
   * derived funding requirement so a founder sees a schedule before deciding
   * on a number.
   */
  loanAmount?: Assumption<number>;
  annualInterestRatePct?: Assumption<number>;
  /** Total loan life in months, grace period included. Defaults to 60 when absent. */
  termMonths?: Assumption<number>;
  /** Interest-only months before principal amortization starts. */
  gracePeriodMonths?: Assumption<number>;
  /** Debt service already committed on existing facilities, per month. */
  existingMonthlyDebtService?: Assumption<number>;
  /** Cash the founders put in themselves alongside the loan (equity injection). */
  founderContribution?: Assumption<number>;
  /** Appraised value of assets pledged as security. */
  collateralValue?: Assumption<number>;
  /** What is being pledged — property, equipment, receivables, deposits. */
  collateralDescription?: string;
  /** Whether the founders are personally on the hook for the debt. */
  personalGuarantee?: boolean;
  /** Monthly revenue already under signed contract — the part a lender treats as committed. */
  contractedMonthlyRevenue?: Assumption<number>;
  /** Minimum DSCR the lender underwrites to. Defaults to 1.25 when absent. */
  targetDscr?: Assumption<number>;
  /** Revenue haircut applied in the downside case. Defaults to 30 when absent. */
  downsideRevenueHaircutPct?: Assumption<number>;
}

// ---------------------------------------------------------------------------
// Step 8 - Validation assessment (1-5 ratings)
// ---------------------------------------------------------------------------

export interface ValidationAssessment {
  problemPain: number;
  problemFrequency: number;
  problemAlreadySpendingMoney: number;
  customersInterviewed: number;
  hasUsers: number;
  hasPayingCustomers: number;
  hasSignedLois: number;
  customersRequestedSolution: number;
  technicallyFeasible: number;
  mvpDifficulty: number;
  productDifferentiation: number;
  knowsHowToReachCustomers: number;
  hasAudience: number;
  hasPartnerships: number;
  hasUnfairDistributionAdvantage: number;
  competitionIntensity: number;
  differentiationStrength: number;
  switchingEase: number;
}

// ---------------------------------------------------------------------------
// Step 9 - Team assessment (1-5 ratings)
// ---------------------------------------------------------------------------

export interface TeamAssessment {
  domainExpertise: number;
  technicalAbility: number;
  salesCapability: number;
  marketingCapability: number;
  founderCommitment: number;
  industryRelationships: number;
  accessToCapital: number;
}

// ---------------------------------------------------------------------------
// Step 10 - Risk assessment (1-5 ratings, high = risky)
// ---------------------------------------------------------------------------

export interface RiskAssessment {
  technicalRisk: number;
  marketRisk: number;
  regulatoryRisk: number;
  competitiveRisk: number;
  financialRisk: number;
  dependencyRisk: number;
}

// ---------------------------------------------------------------------------
// Step 11 - Pitch narrative (optional, investor-deck content only — not
// used by any calculation or score, so absence never affects viability).
// ---------------------------------------------------------------------------

export interface TractionDataPoint {
  id: string;
  /** e.g. "Jan 2026" or "Month 3" — free-form, whatever the user tracks by. */
  label: string;
  customers?: number;
  mrr?: number;
}

export interface PitchTeamMember {
  id: string;
  name: string;
  role: string;
  bio?: string;
}

export interface PitchCompetitor {
  id: string;
  name: string;
  /** Your differentiation against this specific competitor. */
  edge: string;
}

export type FundingRoundType = "pre_seed" | "seed" | "series_a" | "series_b_plus" | "bridge";

export interface PitchRoundDetails {
  roundType?: FundingRoundType;
  valuation?: number;
  previousInvestors?: string;
}

export interface PitchAssumptions {
  problemStatement?: string;
  competitiveLandscape?: string;
  traction?: string;
  teamBios?: string;
  vision?: string;
  fundingAsk?: Assumption<number>;
  useOfFunds?: string;
  /**
   * Deck-only structured extras. These are never part of the main wizard —
   * they're entered from within the Pitch Deck view itself (see
   * /project/[id]/pitch-deck/edit), since they only matter to someone who
   * actually wants to generate a deck.
   */
  tractionHistory?: TractionDataPoint[];
  teamMembers?: PitchTeamMember[];
  competitors?: PitchCompetitor[];
  round?: PitchRoundDetails;
}

// ---------------------------------------------------------------------------
// Step 12 - Business-building documents (optional, post-viability-report).
// Each slice backs one document under /project/[id]/<slug> — structured
// forms only, no AI. Fields present elsewhere on Project (description,
// pricing, competitors) are auto-filled into these via useLinkedField and
// stay editable; absence never affects viability scoring.
// ---------------------------------------------------------------------------

/** Business One-Pager (/project/[id]/one-pager). */
export interface OnePagerAssumptions {
  problem?: string;
  /** Shared default with IcpAssumptions.customerProfile via useLinkedField. */
  customer?: string;
  /** Defaults to basicInfo.description via useLinkedField. */
  solution?: string;
  differentiation?: string;
  /** Shared default with PitchAssumptions.useOfFunds via useLinkedField. Paired with a computed funding snapshot. */
  useOfFunds?: string;
}

/** ICP Document (/project/[id]/icp). */
export interface IcpAssumptions {
  /** Shared default with OnePagerAssumptions.customer via useLinkedField. */
  customerProfile?: string;
  buyerDecisionMaker?: string;
  painPoints?: string;
  /** Defaults to a list of PitchAssumptions.competitors names via useLinkedField. */
  currentAlternatives?: string;
  buyingTriggers?: string;
}

/** Value Proposition & Offer (/project/[id]/value-prop). */
export interface ValuePropAssumptions {
  /** Defaults to basicInfo.description via useLinkedField. */
  whatYouSell?: string;
  customerOutcome?: string;
  scope?: string;
  whyBuyNow?: string;
}

export interface ValidationInterviewQuestion {
  id: string;
  text: string;
}

/** Customer Validation Plan (/project/[id]/validation-plan). */
export interface ValidationPlanAssumptions {
  interviewQuestions?: ValidationInterviewQuestion[];
  /** Defaults to a static suggestion (15) via useLinkedField. */
  targetInterviews?: number;
  successFailureCriteria?: string;
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
}

/** MVP / Product Scope (/project/[id]/mvp-scope). */
export interface MvpScopeAssumptions {
  /** Shared default with ValuePropAssumptions.scope via useLinkedField. */
  mustHaveFunctionality?: string;
  explicitlyExcluded?: string;
  userFlow?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
}

export interface ProspectListItem {
  id: string;
  company: string;
  contact?: string;
  status?: string;
}

/** Go-To-Market Plan (/project/[id]/gtm-plan). */
export interface GtmPlanAssumptions {
  acquisitionChannels?: string;
  salesProcess?: string;
  /** Defaults to a composed draft from ValuePropAssumptions via useLinkedField. */
  messaging?: string;
  prospectList?: ProspectListItem[];
  /** Defaults to pricing.expectedCustomers12mo via useLinkedField. */
  salesTargets?: number;
}

export interface DemoScriptStep {
  id: string;
  text: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer?: string;
}

/**
 * Sales Documents (/project/[id]/sales-docs). The "sales one-pager/deck"
 * item is deliberately not a stored field here — it reuses the Business
 * One-Pager and Investor Pitch Deck content directly rather than asking the
 * user to re-enter it.
 */
export interface SalesDocsAssumptions {
  demoScript?: DemoScriptStep[];
  /** Defaults to a composed template from pricing via useLinkedField. */
  proposalTemplate?: string;
  faq?: FaqItem[];
}

/** Contract / Terms (/project/[id]/contract-terms). */
export interface ContractTermsAssumptions {
  /** Shared default with MvpScopeAssumptions.mustHaveFunctionality via useLinkedField. */
  scope?: string;
  /** Defaults to a composed template from pricing via useLinkedField. */
  payment?: string;
  ip?: string;
  liability?: string;
  cancellation?: string;
  supportTerms?: string;
}

export type PilotAssumptionStatus = "open" | "confirmed" | "invalidated";

export interface PilotAssumptionUpdate {
  id: string;
  label: string;
  status: PilotAssumptionStatus;
}

export interface PilotLogEntry {
  id: string;
  label: string;
  text?: string;
}

export interface PilotFeedbackItem {
  id: string;
  quote: string;
  source?: string;
}

export type PilotDecision = "continue" | "pivot" | "kill";

/** Pilot / Experiment Report (/project/[id]/pilot-report) — the last stage, closing the loop back into the viability engine's own verdict. */
export interface PilotReportAssumptions {
  /** Defaults to a joined list from GtmPlanAssumptions.prospectList via useLinkedField. */
  whoContacted?: string;
  whatHappened?: PilotLogEntry[];
  salesResults?: string;
  customerFeedback?: PilotFeedbackItem[];
  /** Defaults to the unverified assumptions list via a "Suggest from assumptions" action, each starting "open". */
  updatedAssumptions?: PilotAssumptionUpdate[];
  /** Defaults from generateDecisionSummary's verdict, mapped via suggestPilotDecision. */
  decision?: PilotDecision;
}

// ---------------------------------------------------------------------------
// Aggregate project record
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  /** Version of the persisted raw project document. */
  schemaVersion: number;
  /** Optimistic-concurrency revision assigned by the repository. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Owner's user id. Server-populated; never accepted from a saved document. */
  ownerId?: string;
  /** Current viewer's effective access level. Server-populated; never accepted from a saved document. */
  viewerAccess?: "owner" | "read" | "write";
  basicInfo: BasicInfo;
  market: MarketAssumptions;
  pricing: PricingAssumptions;
  /**
   * Optional hybrid revenue mix. When at least one stream carries data it
   * drives revenue, margin, LTV and the forecast instead of the single
   * `pricing.productPrice` x `billingPeriod` model, which stays as the
   * fallback for projects that only sell one thing.
   */
  revenueStreams?: RevenueStream[];
  /** Optional — only populated/shown when basicInfo.businessModel is "marketplace". */
  marketplace?: MarketplaceAssumptions;
  acquisition: AcquisitionAssumptions;
  retention: RetentionAssumptions;
  unitEconomics: UnitEconomicsAssumptions;
  costs: CostAssumptions;
  funding: FundingAssumptions;
  /** Optional — debt-financing inputs, read only by Lender Mode. */
  debt?: DebtAssumptions;
  validation: ValidationAssessment;
  team: TeamAssessment;
  risk: RiskAssessment;
  /** Optional — absent on projects created before this step existed. */
  pitch?: PitchAssumptions;
  /** Optional — absent until the user starts building business documents. */
  onePager?: OnePagerAssumptions;
  icp?: IcpAssumptions;
  valueProp?: ValuePropAssumptions;
  validationPlan?: ValidationPlanAssumptions;
  mvpScope?: MvpScopeAssumptions;
  gtmPlan?: GtmPlanAssumptions;
  salesDocs?: SalesDocsAssumptions;
  contractTerms?: ContractTermsAssumptions;
  pilotReport?: PilotReportAssumptions;
}

// ---------------------------------------------------------------------------
// Calculated outputs
// ---------------------------------------------------------------------------

export interface MarketFunnelStageMetrics {
  id: string;
  label: string;
  /** Accounts left after this filter. */
  accounts: number;
  /** Share (0-100) of the immediately preceding population that survives here. */
  survivalPct: number;
  /** Share (0-100) of the starting universe that survives to here. */
  shareOfUniversePct: number;
  /** Annual revenue this population represents at the average annual spend. */
  annualValue: number;
  /** True when the stage holds more accounts than the one before it — a filter that adds accounts is a data error. */
  isExpanding: boolean;
}

export interface MarketFunnelMetrics {
  /** The starting universe first, then one entry per filter stage. */
  stages: MarketFunnelStageMetrics[];
  universeAccounts: number;
  /** Population behind SAM. */
  addressableAccounts: number;
  /** Population behind SOM before the win rate is applied. */
  qualifiedAccounts: number;
  /** Qualified accounts x win rate — the accounts SOM assumes we close. */
  obtainableAccounts: number;
  /** Share (0-100) of the starting universe that survives the whole funnel. */
  overallQualificationPct: number;
}

export interface MarketMetrics {
  tam: number;
  sam: number;
  som: number;
  requiredMarketPenetrationPct: number;
  /** Which model produced the numbers above. */
  method: MarketSizingMethod;
  /** Accounts SAM is built on — the denominator of required penetration. */
  addressableCustomers: number;
  /** Stage-by-stage breakdown; null unless the funnel method is active. */
  funnel: MarketFunnelMetrics | null;
}

export interface RevenueMetrics {
  monthlyArpu: number;
  mrr: number;
  arr: number;
  monthlyRevenue: number;
  annualRevenue: number;
}

export interface AcquisitionMetrics {
  /** null when spend was entered but zero customers were acquired — CAC is unknown, not $0. */
  cac: number | null;
  leadToCustomerConversionPct: number | null;
}

export interface RetentionMetrics {
  monthlyChurnPct: number;
  customerLifetimeMonths: number | null;
  /** Annualized Net Revenue Retention — point-in-time, from monthly churn/expansion/contraction. */
  netRevenueRetentionPct: number;
}

export interface UnitEconomicsMetrics {
  variableCostPerCustomer: number;
  grossProfitPerCustomer: number;
  grossMarginPct: number;
  ltv: number;
  ltvToCacRatio: number | null;
  cacPaybackMonths: number | null;
  /**
   * Monthly contribution from the recurring part of the mix (subscription,
   * usage, take rate) — the part that compounds over a customer's lifetime.
   * Equals `grossProfitPerCustomer` for single-stream projects.
   */
  recurringGrossProfitPerCustomer: number;
  /**
   * Contribution earned once, on acquisition (audit, setup, implementation).
   * 0 for single-stream projects; it offsets CAC instead of compounding.
   */
  oneTimeGrossProfitPerCustomer: number;
}

export interface OperatingMetrics {
  monthlyOperatingCost: number;
  monthlyBurn: number;
  isCashFlowPositive: boolean;
}

export interface FundingMetrics {
  runwayMonths: number | null;
  isProfitable: boolean;
}

export interface BreakEvenMetrics {
  contributionMarginPerCustomer: number;
  breakEvenCustomers: number | null;
  breakEvenRevenue: number | null;
  remainingCustomersToBreakEven: number | null;
}

export type ConcentrationRiskLevel = "low" | "moderate" | "high" | "severe";

export interface DilutionMetrics {
  postMoneyValuation: number | null;
  equityGivenUpPct: number | null;
  founderRemainingOwnershipPct: number | null;
}

export interface MarketplaceMetrics {
  gmv: number;
  takeRateRevenue: number;
  effectiveArpu: number;
  takeRatePct: number;
}

export interface ConcentrationMetrics {
  topCustomersRevenueSharePct: number;
  riskLevel: ConcentrationRiskLevel;
}

export interface RevenueStreamMetrics {
  id: string;
  name: string;
  kind: RevenueStreamKind;
  /** True for recurring/usage/transactional — revenue that repeats while the customer stays. */
  isRecurring: boolean;
  /**
   * Revenue this stream contributes each month: recurring kinds bill the whole
   * customer base, `one_time` bills only that month's newly acquired customers.
   */
  monthlyRevenue: number;
  /** Share of total monthly revenue, 0-100. */
  revenueSharePct: number;
  /** Recurring kinds: per existing customer per month. `one_time`: per newly acquired customer. */
  revenuePerCustomer: number;
  grossMarginPct: number;
  monthlyGrossProfit: number;
  /** Transaction volume this stream runs through the product (transactional kind only, else 0). */
  monthlyGmv: number;
}

/**
 * Blended economics across every revenue stream. Null when a project has no
 * stream data, in which case the single-price `pricing` model still governs.
 */
export interface RevenueMixMetrics {
  streams: RevenueStreamMetrics[];
  /** Recurring revenue per existing customer per month (the ARPU that compounds). */
  recurringArpu: number;
  /** One-time revenue collected per newly acquired customer. */
  oneTimeRevenuePerNewCustomer: number;
  /** Recurring ARPU annualized plus each one-time purchase counted once per customer. */
  blendedAnnualRevenuePerCustomer: number;
  monthlyRecurringRevenue: number;
  monthlyOneTimeRevenue: number;
  totalMonthlyRevenue: number;
  /** 0-100. How much of this month's revenue repeats next month without new sales. */
  recurringRevenueSharePct: number;
  /** Revenue-weighted margins. `blended` mixes both halves at the current new-customer rate. */
  blendedGrossMarginPct: number;
  recurringGrossMarginPct: number;
  oneTimeGrossMarginPct: number;
  /** Total transaction volume across transactional streams. */
  monthlyGmv: number;
}

export interface CalculatedMetrics {
  market: MarketMetrics;
  revenue: RevenueMetrics;
  acquisition: AcquisitionMetrics;
  retention: RetentionMetrics;
  unitEconomics: UnitEconomicsMetrics;
  operating: OperatingMetrics;
  funding: FundingMetrics;
  breakEven: BreakEvenMetrics;
  dilution: DilutionMetrics;
  concentration: ConcentrationMetrics;
  /** Only populated when businessModel is "marketplace" and the marketplace slice has data. */
  marketplace: MarketplaceMetrics | null;
  /** Only populated when the project defines at least one revenue stream with data. */
  revenueMix: RevenueMixMetrics | null;
}

// ---------------------------------------------------------------------------
// SaaS efficiency ratios — sibling to CalculatedMetrics, not a member of it,
// since these are derived from a 12-month forecast and CalculatedMetrics must
// not depend on the forecast (the forecast itself takes CalculatedMetrics as
// an input — a dependency in the other direction would be circular).
// ---------------------------------------------------------------------------

export interface EfficiencyMetrics {
  annualGrowthPct: number | null;
  profitMarginPct: number | null;
  ruleOf40Score: number | null;
  burnMultiple: number | null;
  magicNumber: number | null;
  quickRatio: number | null;
}

/**
 * How much external financing the plan actually needs, derived from the
 * forecast rather than entered by the founder. Same sibling-of-
 * CalculatedMetrics rule as EfficiencyMetrics above: it consumes a forecast,
 * so it cannot live inside CalculatedMetrics.
 */
export interface FundingRequirementMetrics {
  /** Length of the funded window, in months. */
  monthsToMilestone: number;
  /** Cash out over the window: operating expenses plus variable costs. */
  operatingSpendToMilestone: number;
  /** Cash in over the window: revenue plus other monthly income. */
  expectedCashReceipts: number;
  /** Safety buffer: `safetyBufferMonths` of net burn at the milestone-month run rate. */
  safetyBuffer: number;
  /** Cash tied up in receivables at the milestone-month revenue run rate. */
  workingCapital: number;
  /** One-time capital expenditure carried straight through from the assumptions. */
  capex: number;
  /** Cash already on hand (excludes `initialInvestment`, which is the raise being sized). */
  cashOnHand: number;
  /** Spend + buffer + working capital + CAPEX − receipts − cash on hand, floored at 0. */
  requiredFinancing: number;
  contingencyPct: number;
  contingencyAmount: number;
  /** Required financing plus contingency, rounded up to a round number a founder would actually ask for. */
  recommendedRaise: number;
  /** First forecast month with non-negative net cash flow, or null if none within 36 months. */
  breakEvenMonth: number | null;
  /** True when receipts and cash on hand already cover the plan — nothing to raise. */
  isSelfFunded: boolean;
}

// ---------------------------------------------------------------------------
// Forecasting
// ---------------------------------------------------------------------------

export interface ForecastMonth {
  month: number;
  beginningCustomers: number;
  newCustomers: number;
  churnedCustomers: number;
  endingCustomers: number;
  mrr: number;
  revenue: number;
  variableCosts: number;
  grossProfit: number;
  operatingExpenses: number;
  netCashFlow: number;
  cashBalance: number;
  /** Revenue that repeats: subscription/usage/take-rate MRR including expansion. */
  recurringRevenue: number;
  /** Revenue earned once, from this month's newly acquired customers (audits, setup, implementation). */
  oneTimeRevenue: number;
  /** Revenue added this month from upsell/cross-sell to existing customers (0 for non-recurring or when unset). */
  expansionRevenue: number;
  /** Revenue lost this month from downgrades among existing customers (0 for non-recurring or when unset). */
  contractionRevenue: number;
}

// ---------------------------------------------------------------------------
// Scenario analysis
// ---------------------------------------------------------------------------

export type ScenarioName = "conservative" | "base" | "optimistic";

export interface ScenarioSummary {
  name: ScenarioName;
  label: string;
  revenue: number;
  mrr: number;
  customers: number;
  profit: number;
  runwayMonths: number | null;
  breakEvenMonth: number | null;
}

export interface ScenarioResult {
  scenarios: Record<ScenarioName, ScenarioSummary>;
  forecasts: Record<ScenarioName, ForecastMonth[]>;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ScoreCategory =
  | "market"
  | "unitEconomics"
  | "financial"
  | "validation"
  | "execution"
  | "risk";

export interface CategoryScore {
  category: ScoreCategory;
  label: string;
  score: number; // 0-100
  weight: number; // 0-1
  factors: ScoreFactor[];
}

export interface ScoreFactor {
  label: string;
  score: number; // 0-100
  detail: string;
}

export interface ScoreBreakdown {
  overall: number; // 0-100
  categories: Record<ScoreCategory, CategoryScore>;
  confidence: number; // 0-100
  maturityStage: MaturityStage;
}

export type MaturityStageId = 0 | 1 | 2 | 3 | 4 | 5;

export interface MaturityStage {
  stage: MaturityStageId;
  label: string;
  description: string;
}

export type ViabilityClassification =
  | "High Risk"
  | "Weak"
  | "Promising"
  | "Strong"
  | "Very Strong";

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface Insight {
  id: string;
  /** Translation key (the English source string, used verbatim as an i18n message id). */
  message: string;
  messageParams?: Record<string, string | number>;
  /** Translation key for the secondary line, if any. */
  detail?: string;
  detailParams?: Record<string, string | number>;
}

export interface InsightReport {
  /**
   * Assumptions that disagree with each other (e.g. expected customers vs the
   * acquisition model, entered lifetime vs the churn rate). Surfaced
   * separately from warnings because these are internal inconsistencies that
   * would embarrass the document in front of an investor, not judgments.
   */
  contradictions: Insight[];
  strengths: Insight[];
  warnings: Insight[];
  criticalRisks: Insight[];
  opportunities: Insight[];
  recommendedActions: Insight[];
}

export type DecisionVerdict =
  | "explore_further"
  | "validate_before_building"
  | "improve_economics"
  | "strong_candidate"
  | "high_risk";

export interface DecisionReason {
  /** Translation key (the English source string, used verbatim as an i18n message id). */
  template: string;
  params?: Record<string, string | number>;
}

export interface DecisionSummary {
  verdict: DecisionVerdict;
  title: string;
  description: string;
  reasons: DecisionReason[];
}

// ---------------------------------------------------------------------------
// Audience modes (Investor / Lender)
//
// The same project, underwritten by two different readers. A VC buys the upside
// distribution — market size, growth, moat, expansion, the exit. A bank buys
// the downside floor — can this pay a fixed amount every month, and what backs
// it if it can't. Neither one is a subset of the other, so each audience gets
// its own metric set, its own pass/fail checks, and its own verdict.
// ---------------------------------------------------------------------------

export type AudienceCheckStatus = "pass" | "warn" | "fail";

/**
 * One underwriting test, phrased the way the audience would phrase it.
 * `label`, `requirement` and `detail` are translation keys (the English source
 * string used verbatim as an i18n message id), with any numbers travelling as
 * params so the UI can translate them — the same convention as `Insight`.
 */
export interface AudienceCheck {
  id: string;
  label: string;
  status: AudienceCheckStatus;
  /** Already-formatted figure for this project, e.g. "1.4x" or "OMR 120,000". */
  value: string;
  /** What the audience wants to see, e.g. "≥ 1.25x". */
  requirement: string;
  detail?: string;
  detailParams?: Record<string, string | number>;
}

// --- Lender Mode -----------------------------------------------------------

export interface RepaymentMonth {
  month: number;
  openingBalance: number;
  interest: number;
  /** 0 during the interest-only grace period. */
  principal: number;
  payment: number;
  closingBalance: number;
}

export interface DebtServiceMonth {
  month: number;
  /**
   * Cash Available For Debt Service: gross profit − operating expenses + other
   * income, i.e. the forecast's net cash flow before any debt service.
   */
  cashAvailableForDebtService: number;
  /** This loan's payment plus any debt service already committed elsewhere. */
  debtService: number;
  /** CFADS / debt service. Null when there is no debt service to cover. */
  dscr: number | null;
  /** Running cash after debt service, starting from cash + founder contribution + loan proceeds. */
  cashBalance: number;
}

export interface AnnualDebtService {
  year: number;
  cashAvailableForDebtService: number;
  debtService: number;
  dscr: number | null;
}

/** Same DSCR math re-run on a revenue-haircut forecast — the bank's stress case. */
export interface DownsideCase {
  revenueHaircutPct: number;
  minDscr: number | null;
  /** Aggregate DSCR: total CFADS / total debt service over the term. */
  aggregateDscr: number | null;
  monthsBelowOne: number;
  lowestCashBalance: number;
  /** True when the stressed plan still covers every payment without running the cash to zero. */
  survives: boolean;
}

export interface LenderMetrics {
  loanAmount: number;
  /** True when `loanAmount` came from the derived funding requirement rather than being entered. */
  loanAmountIsDerived: boolean;
  annualInterestRatePct: number;
  termMonths: number;
  gracePeriodMonths: number;
  /** Level payment once amortization starts (interest-only payments are lower). */
  monthlyPayment: number;
  /** Loan payment plus existing commitments — what has to clear every month. */
  totalMonthlyDebtService: number;
  totalInterest: number;
  totalRepayment: number;
  schedule: RepaymentMonth[];
  service: DebtServiceMonth[];
  annual: AnnualDebtService[];
  targetDscr: number;
  minDscr: number | null;
  /** Total CFADS / total debt service across the term — the figure a credit memo quotes. */
  aggregateDscr: number | null;
  monthsBelowTargetDscr: number;
  /** First month the loan is fully covered (DSCR ≥ 1), or null if it never is. */
  firstCoveredMonth: number | null;
  /** Largest principal the plan's own cash flow supports at the target DSCR. */
  debtCapacity: number;
  /** Debt capacity − loan amount. Negative means the ask exceeds what the plan services. */
  headroom: number;
  /** Collateral value / loan amount. Null when no collateral was entered. */
  collateralCoverageRatio: number | null;
  /** Founder cash as a share of total funding (founder + loan), 0-100. */
  founderContributionPct: number | null;
  /** Contracted monthly revenue / total monthly debt service. Null when nothing is contracted. */
  contractedRevenueCover: number | null;
  /** Cash tied up in receivables at the current revenue run rate. */
  receivablesBalance: number;
  breakEvenMonth: number | null;
  lowestCashBalance: number;
  monthsCashNegative: number;
  downside: DownsideCase;
}

export type LenderVerdict = "bankable" | "conditional" | "not_bankable";

export interface LenderAssessment {
  verdict: LenderVerdict;
  title: string;
  description: string;
  checks: AudienceCheck[];
}

// --- Investor Mode ---------------------------------------------------------

/** A dated point the plan reaches, used to answer "what does this round buy". */
export interface InvestorMilestone {
  id: string;
  /** Forecast month it lands in, or null when the plan never reaches it. */
  month: number | null;
  label: string;
  labelParams?: Record<string, string | number>;
  detail: string;
  detailParams?: Record<string, string | number>;
}

export interface InvestorSummary {
  arrNow: number;
  arrMonth12: number;
  arrMonth24: number;
  /** ARR multiple over the next 12 months. Null before there is any ARR to grow. */
  growthMultiple12mo: number | null;
  customersMonth12: number;
  netRevenueRetentionPct: number;
  monthlyExpansionRevenuePct: number;
  ltvToCacRatio: number | null;
  cacPaybackMonths: number | null;
  grossMarginPct: number;
  /** Growth rate + profit margin over the next 12 months. Null for non-recurring models. */
  ruleOf40Score: number | null;
  burnMultiple: number | null;
  magicNumber: number | null;
  /** 0-100, built from the differentiation/switching-cost/distribution ratings. */
  moatScore: number;
  /** 0-100, built from the paying-customers/LOI/interview evidence. */
  tractionScore: number;
  /** Share of SAM the plan needs to hit its target — the "is this credible" sanity check. */
  requiredMarketPenetrationPct: number;
  /** Ask from the pitch narrative when entered, otherwise the derived recommended raise. */
  fundingAsk: number;
  fundingAskIsDerived: boolean;
  /** Months of runway the ask buys at the milestone-month net burn. Null when cash-flow positive. */
  runwayFromAskMonths: number | null;
  equityGivenUpPct: number | null;
  postMoneyValuation: number | null;
  milestones: InvestorMilestone[];
  checks: AudienceCheck[];
}

export type InvestorVerdict = "fundable" | "promising" | "too_early";

export interface InvestorAssessment {
  verdict: InvestorVerdict;
  title: string;
  description: string;
}
