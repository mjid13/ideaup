# IdeaUp

Stress-test a business idea before committing time and capital. IdeaUp turns
structured assumptions about the market, revenue model, acquisition, retention,
costs, funding, evidence, team, and risk into transparent economics, forecasts,
uncertainty analysis, and a practical next decision.

The tool does not predict success. It keeps viability separate from confidence,
shows which assumptions drive the result, and helps decide what to fix,
validate, build, or stop next.

**Structured assumptions → traceable metrics → stress-tested forecast → clear
decision → reusable business documents.**

## Contents

- [Product capabilities](#product-capabilities)
- [Architecture](#architecture)
- [Application data flow](#application-data-flow)
- [Setup](#setup)
- [Calculation formulas](#calculation-formulas)
- [Scoring methodology](#scoring-methodology)
- [Business-model benchmarks](#business-model-benchmarks)
- [Confidence vs. viability](#confidence-vs-viability)
- [Persistence](#persistence)
- [Hosted MCP capabilities](#hosted-mcp-capabilities)
- [Testing](#testing)
- [License](#license)

## Product capabilities

- **Flexible business modeling** — eight business-model labels, six currencies,
  direct/top-down/bottom-up-funnel market sizing, and any mix of recurring,
  one-time, usage, transactional, or marketplace revenue.
- **Evidence-aware assumptions** — every numeric input is marked known,
  estimated, or unknown and may carry a low/most-likely/high range instead of a
  falsely precise point estimate.
- **Decision dashboard** — market, revenue, acquisition, retention, unit
  economics, concentration, operating cost, break-even, runway, funding,
  dilution, and recurring-revenue efficiency metrics.
- **Stress testing** — 12/24/36-month forecasts, bear/base/bull scenarios,
  sensitivity ranking, deterministic contradiction detection, and reproducible
  Monte Carlo simulation across ranged assumptions.
- **Separate decision signals** — a transparent 0-100 viability score, an
  evidence confidence percentage, validation maturity Stage 0-5, benchmarked
  category scores, risks, recommended actions, and a next-step verdict.
- **Business-building documents** — Business One-Pager, ICP, Value Proposition
  & Offer, Customer Validation Plan, Financial Model, MVP Scope, Go-To-Market
  Plan, Sales Documents, Contract Terms, and Pilot Report. Derived sections reuse
  project data while narrative fields remain editable.
- **Portfolio workflows** — save, duplicate, compare, import, and export projects
  as JSON or CSV. English and Arabic interfaces are included.
- **AI/client workflows** — an optional OAuth-protected hosted MCP server exposes
  scoped analysis, scenarios, investor and lender assessments, document drafts,
  and controlled project updates.

## Architecture

The app is a Next.js (App Router) + TypeScript + Tailwind + shadcn/ui project.
Business logic is kept entirely out of React components:

```text
/src
  /app                     Routes: landing, sign-in, wizard, project workspace
                           (dashboard + business documents), projects, compare,
                           settings, OAuth consent, /api (projects CRUD),
                           /mcp (hosted MCP server), /health
  /components
    /ui                    shadcn/ui primitives
    /forms                 Multi-step wizard, field components, form <-> domain mapping
    /dashboard             Score, metrics, insights, sensitivity, scenarios, charts
    /documents             Generated business-document primitives (one-pager, pitch, …)
    /auth                  Sign-in and OAuth consent forms
    /audience              Investor / lender audience views
    /settings              MCP connection management
    /i18n                  Translation provider and helpers
    /layout                Header and footer
  /lib
    /calculations          Pure financial calculation engine (TAM/SAM/SOM, CAC, LTV,
                           break-even, forecasting, scenarios, Monte Carlo, sensitivity)
    /scoring               Scoring engine: benchmarks, category scorers, confidence,
                           validation maturity
    /insights              Deterministic insight + decision-summary generation
    /projects              Supabase-backed repository, codec, safe mutations
    /storage               ProjectRepository interface + localStorage implementation
    /supabase              Browser/server clients and env detection
    /mcp                   MCP server: composition root, tool modules, pure
                           payload views, typed errors, OAuth auth, rate limiting
    /documents             Document registry, derivation, status
    /export                Project export/import
    /investor, /lender     Investor summary and lender assessment logic
    /security              Application-layer project encryption
    /http                  Request-origin handling for redirects
    /forms                 Shared linked-field behavior
    /validation            Zod schemas for the wizard and stored documents
    format.ts              Currency/percentage/multiple/month formatting helpers
    example.ts             Pre-populated example project
  /messages                English + Arabic message catalogs
  /types                   Domain types: Project, *Assumptions, CalculatedMetrics,
                           ScoreBreakdown, ForecastMonth, ScenarioResult, …
```

Every calculation is a pure function of typed inputs — no React, no I/O — and is
unit tested independently of the UI (see [Testing](#testing)).

## Application data flow

The UI does not fetch Supabase directly. Pages and components call the shared
`ProjectRepository` contract:

```text
page/component
  → projectRepository
    → localStorage in development when Supabase is absent
    → fetch('/api/projects[...]', { cache: 'no-store' }) when Supabase is configured
      → authenticated Next.js route handler
        → SupabaseProjectRepository
          → Postgres + RLS + revision checks + audit events
```

`BrowserProjectRepository` owns the project fetchers: list and detail reads use
`GET`, saves/imports use `PUT`, and deletion uses `DELETE`. The route handlers
verify Supabase claims, validate complete project documents with Zod, return a
structured error response, and reject stale revisions with a conflict instead
of silently overwriting newer work. Project calculations, scoring, insights,
forecasts, and document derivation then run locally as pure functions; rendering
a dashboard does not trigger a second analytics API.

MCP uses a separate `/mcp` route with bearer authentication, per-client project
grants, access mode, optional create permission, write gates, rate limits, and
idempotency/revision checks. Connection changes are submitted through
`/api/settings/connections` and recorded as project audit events.

## Setup

```bash
npm install
npm run dev      # start the dev server on http://localhost:3000
npm run test     # run the vitest suite
npm run lint     # eslint
npm run build    # production build (also runs the TypeScript compiler)
```

Out of the box in development — with no environment variables — the app runs
fully client-side and stores projects in the browser's `localStorage`.
Production fails closed when Supabase or project encryption is not configured;
it never silently falls back to browser storage.

To enable accounts and cross-device storage, point the app at a
[Supabase](https://supabase.com) project:

1. Create a Supabase project.
2. Apply the SQL files in `/supabase/migrations/` in timestamp order
   (SQL editor or `supabase db push`).
3. Copy `.env.example` to `.env.local` and fill in your project URL and
   publishable key.

Once those variables are set, projects are stored in Postgres per
authenticated user. The substantive `projects.data` payload is encrypted by
the application before it reaches Postgres when `PROJECT_ENCRYPTION_MODE` is
`required`; project names and operational metadata remain readable. See
[docs/hosted-mcp-setup.md](docs/hosted-mcp-setup.md)
for deploying the optional hosted MCP server.

## Calculation formulas

All formulas live in `/src/lib/calculations` as small, single-purpose modules.
The most important ones, summarized:

| Metric | Formula | Module |
|---|---|---|
| TAM | Total Potential Customers × Average Annual Customer Spend | `market.ts` |
| SAM | TAM × Addressable Market % | `market.ts` |
| SOM | SAM × Obtainable Market % | `market.ts` |
| Required penetration | Target Customers / Addressable Customers | `market.ts` |
| Marketplace GMV | Customers × Transactions per Customer × Average Order Value | `marketplace.ts` |
| Marketplace revenue | GMV × Take Rate % | `marketplace.ts` |
| Stream revenue | Price × Attach Rate × Units × Applicable Customer Base | `revenueStreams.ts` |
| MRR | Monthly Customers × Monthly ARPU | `pricing.ts` |
| ARR | MRR × 12 | `pricing.ts` |
| CAC | (Marketing Spend + Sales Spend) / New Customers | `acquisition.ts` |
| Customer lifetime (months) | 1 / Monthly Churn Rate | `retention.ts` |
| Gross margin | Gross Profit / Revenue | `unitEconomics.ts` |
| LTV | Monthly ARPU × Gross Margin % / Monthly Churn Rate | `unitEconomics.ts` |
| LTV:CAC | LTV / CAC | `unitEconomics.ts` |
| CAC payback (months) | CAC / Monthly Gross Profit Per Customer | `unitEconomics.ts` |
| Monthly burn | max(0, Operating Expenses − Revenue) | `opex.ts` |
| Runway (months) | Available Cash / Monthly Burn | `funding.ts` |
| Break-even customers | Fixed Monthly Costs / Contribution Margin Per Customer | `breakeven.ts` |
| Break-even revenue | Break-even Customers × ARPU | `breakeven.ts` |
| Required financing | Spend to Milestone + Safety Buffer + Working Capital + CAPEX − Receipts − Cash | `fundingRequirement.ts` |
| Recommended raise | Required Financing × (1 + Contingency %) rounded up | `fundingRequirement.ts` |
| Post-money valuation | Pre-money Valuation + Investment | `dilution.ts` |
| Equity given up | Investment / Post-money Valuation | `dilution.ts` |
| Rule of 40 | Projected Annual Growth % + Projected Profit Margin % | `efficiency.ts` |
| Burn multiple | 12-month Net Burn / Net New ARR | `efficiency.ts` |
| Debt-service coverage | Cash Available for Debt Service / Debt Service | `debt.ts` |

**Edge cases** (zero churn, zero CAC, zero revenue, negative contribution margin,
already-profitable businesses, one-time/annual/usage-based billing) are handled
explicitly in each module — see `helpers.ts` (`safeDiv`, `finiteOrZero`) and the
accompanying `__tests__` files. The UI never renders `NaN`, `Infinity`, or
`undefined`; `/src/lib/format.ts` guards every formatter.

Market sizing can also use direct TAM/SAM/SOM values or a bottom-up qualification
funnel with count/percentage stages and explicit SAM/SOM checkpoints. Hybrid
revenue streams are separated into recurring and acquisition-driven cash flows,
then blended by their own delivery margins; marketplace take-rate economics are
modeled from GMV rather than treated like a subscription.

Forecasts (`forecast.ts`, `projectForecast.ts`) generate a month-by-month
projection of cohorts, customers, expansion/contraction, MRR, one-time and
recurring revenue, variable costs, operating expenses, net cash flow, and cash
balance for any horizon. The 12/24/36-month views and scenario engine
(`scenarios.ts`) call the same functions with different inputs. The sensitivity
engine (`sensitivity.ts`) flexes price/CAC/churn/growth ±50% and re-runs the full
scoring pipeline to rank the assumptions that move the result most.

### Assumption ranges and Monte Carlo

Any numeric input can be entered either as a single number or as a range — low,
most likely, high — via the Range toggle on the input itself. A single number
("CAC = OMR 4,000") claims a precision nobody has; a range ("OMR 2,500–5,000,
most likely 4,000") states what is actually known.

`monteCarlo.ts` finds every ranged assumption in a project, draws each one from
a triangular distribution over its own low/most likely/high span, and re-runs
the full metrics + forecast + scoring pipeline once per draw (1,000 runs by
default, seeded from the project id so results are reproducible). It reports
the outcome as a distribution rather than a point forecast:

- probability of reaching break-even before cash runs out — the headline number
- probability of breaking even at all, and of running out of cash, in 24 months
- bear / base / bull columns read off the P10 / P50 / P90 of the simulated
  outcomes (each metric's own percentile, not one single run)
- the full distribution of break-even months, including runs that never get there

With no ranged assumptions there is nothing to sample, so the panel explains how
to add one instead of showing a fake distribution.

## Scoring methodology

`calculateScoreBreakdown()` in `/src/lib/scoring/index.ts` combines six category
scores (each 0-100) into one overall 0-100 score:

```text
Overall = Market × 20% + Unit Economics × 20% + Financial Viability × 20%
        + Validation × 15% + Execution × 15% + Risk × 10%
```

Each category (`/src/lib/scoring/{market,unitEconomics,financial,validation,execution,risk}.ts`)
documents exactly which inputs it considers and how they're weighted internally.
Scores are computed with `interpolateScore()` (`interpolate.ts`), which linearly
interpolates a metric value between named anchor points (e.g. LTV:CAC of 1x →
20/100, 3x → 68/100, 5x → 90/100) rather than generating arbitrary numbers — every
anchor is visible in source and in the "How this score is calculated" panel on
the dashboard.

Classification bands:

| Score | Label |
|---|---|
| 0–39 | High Risk |
| 40–54 | Weak |
| 55–69 | Promising |
| 70–84 | Strong |
| 85–100 | Very Strong |

## Business-model benchmarks

Gross margin, LTV:CAC, CAC payback, and churn benchmarks differ by business
model — a marketplace's healthy gross margin looks nothing like a SaaS
product's. `/src/lib/scoring/benchmarks.ts` exports:

```ts
const BUSINESS_MODEL_BENCHMARKS: Record<BusinessModel, BusinessModelBenchmarks> = {
  saas: { grossMarginPct: [...], ltvToCac: [...], cacPaybackMonths: [...], monthlyChurnPct: [...] },
  marketplace: { ... },
  ecommerce: { ... },
  service: { ... },
  one_time: { ... },
  // subscription and usage_based currently alias saas; "other" aliases service
};
```

**To tune a benchmark**, edit the anchor points for that business model in
`benchmarks.ts` — each array is `[metricValue, score]` pairs; no other file
needs to change. To add a new business model, add it to the `BusinessModel`
union in `/src/types/index.ts`, add a benchmark set here, and add an option to
`BUSINESS_MODEL_OPTIONS` in `/src/lib/constants.ts`.

## Confidence vs. viability

The **viability score** evaluates whether the economics work *given the
numbers entered*. The **confidence score** (`/src/lib/scoring/confidence.ts`,
0-100%) is a separate axis measuring how much real evidence backs those
numbers — the share of inputs marked "Known" vs. "Estimated" vs. "Unknown",
plus demonstrated validation evidence (interviews, users, paying customers,
LOIs) and whether CAC/churn are based on real data. A project can score 85 on
viability and 30% on confidence if the inputs are mostly guesses — the
dashboard always shows both, deliberately not conflated into one number.

**Validation maturity** (`/src/lib/scoring/maturity.ts`, Stage 0–5: Idea →
Problem Validated → Solution Validated → Revenue Validated → Growth Validated →
Scale Ready) is a third, independent signal — it does not feed the viability
score.

## Persistence

All persistence goes through the `ProjectRepository` interface
(`/src/lib/storage/types.ts`):

```ts
interface ProjectRepository {
  getAll(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}
```

The implementation is chosen at runtime (`/src/lib/storage/browserRepository.ts`):

- **No Supabase env vars in development** → `LocalStorageProjectRepository` —
  everything stays in the browser. Production instead fails closed.
- **Supabase configured** → a thin client that calls the app's own
  `/api/projects` routes. Those routes use `SupabaseProjectRepository`
  (`/src/lib/projects/repository.ts`) with the signed-in user's token: projects
  are stored as encrypted JSONB envelopes protected by row-level security,
  writes go through
  an allowlisted mutation set (`/src/lib/projects/mutations.ts`), and saves use
  optimistic concurrency (`revision` checks) so concurrent edits conflict
  loudly instead of silently overwriting.

Because every page/component depends on the interface, not the
implementation, swapping the backend again requires no calling-code changes.

## Hosted MCP capabilities

The hosted MCP server (`/src/lib/mcp`, served at `/mcp`) exposes the same
engine the UI uses. `server.ts` only registers; every payload is built by a
pure function in `/src/lib/mcp/views` that takes a `Project` and returns data —
which is why they are unit tested without a server or a database.

Two capabilities are reachable **only** through MCP: Lender Mode
(`get_lender_assessment`) and Investor Mode (`get_investor_assessment`) have no
route in the app, and `debt.*` — the loan terms Lender Mode reads — has no
wizard step, so MCP is the only way to populate it.

| Tool | Reads / writes | Underlying function |
| --- | --- | --- |
| `list_projects` | granted project index | `analyzeProject` |
| `get_project` | raw assumptions per section | `rawSections` |
| `get_project_analysis` | metrics, score, insights, forecast, scenarios, sensitivity, efficiency, funding requirement, benchmarks | `analyzeProject`, `financialModelView` |
| `get_missing_assumptions` | unknown/estimated assumptions, optionally inside lists | `findMissingAssumptions` |
| `get_writable_paths` | every path `update_project` accepts | `leafPaths` |
| `run_scenario` | temporary overrides and/or price/CAC/churn/growth multipliers | `applyMultipliers`, `applyProjectChanges` |
| `run_monte_carlo` | distribution across ranged assumptions | `runMonteCarlo` |
| `get_lender_assessment` | DSCR, liquidity, downside, capacity, collateral | `calculateLenderMetrics`, `assessLenderReadiness` |
| `get_investor_assessment` | growth, retention, efficiency, moat, round | `buildInvestorSummary`, `assessInvestorReadiness` |
| `get_benchmarks` | scoring anchors, optionally with this project's figures | `getBenchmarks` |
| `list_documents` | per-document status and filled/total | `computeDocumentCompleteness` |
| `suggest_document_content` | deterministic drafts, each with the path that persists it | `/src/lib/documents/derive.ts` |
| `compare_projects` | two to five projects side by side | `analyzeProject` |
| `export_project` | full JSON bundle or flattened CSV | `buildExportBundle`, `buildExportCsv` |
| `get_example_project` | the reference fixture, schema included | `exampleProject` |
| `create_project` / `import_project` | **write** — new project, granted to the calling client | `create_project_with_mcp_grant` |
| `update_project` | **write** — allowlisted field changes, including one list item | `applyProjectChanges` |
| `add_revenue_stream` / `remove_revenue_stream` / `reorder_revenue_streams` | **write** — the hybrid revenue mix, item by item | `/src/lib/projects/listMutations.ts` |
| `edit_list` | **write** — append/replace/remove/move one item in a document list | `applyListOperation` |

Resources are `ideaup://projects`, `ideaup://example`,
`ideaup://benchmarks/{business_model}`, and
`ideaup://projects/{id}/{kind}` where `kind` is any stored section plus
`summary`, `assumptions`, `analysis`, `financial_model`, `lender`, `investor`,
and `documents`. Ten prompts cover challenging assumptions, prioritising
validation, unit economics, founder review, comparison, investor readiness,
lender underwriting, downside risk, document drafting, and filling unknowns.

Writes stay off unless `MCP_WRITES_ENABLED=true`, the connection is in
read/write mode, and — for creation — the owner allowed it. See
[docs/hosted-mcp-setup.md](docs/hosted-mcp-setup.md) for deployment and
[docs/mcp-tools.md](docs/mcp-tools.md) for the client-facing contract.

## Testing

```bash
npm run test
```

329 vitest test cases cover the calculation, forecast, funding, uncertainty,
scoring, insight, document, persistence, encryption, HTTP, i18n, export/import,
and MCP layers. The suite includes zero-churn, zero-CAC, zero-revenue,
negative-margin, authorization, rate-limit, conflict, and encryption edge cases.
Financial correctness is treated as more important than visual polish, per the
project's own principle.

## License

[MIT](LICENSE)
