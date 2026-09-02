"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppTranslations } from "@/components/i18n/use-app-translations";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  FileText,
  Gauge,
  GitCompare,
  LineChart,
  Percent,
  PiggyBank,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { projectRepository } from "@/lib/storage/browserRepository";
import { exampleProject } from "@/lib/example";

const CAPABILITIES = [
  {
    icon: Target,
    title: "Reachable market",
    description: "Size TAM, SAM, and SOM directly, from customer spend, or with a bottom-up qualification funnel.",
  },
  {
    icon: TrendingUp,
    title: "Hybrid revenue model",
    description: "Blend recurring, one-time, usage, transactional, and marketplace revenue in one plan.",
  },
  {
    icon: Percent,
    title: "Unit economics",
    description: "Measure CAC, LTV, LTV:CAC, gross margin, retention, payback, and customer concentration.",
  },
  {
    icon: BarChart3,
    title: "Forecast & break-even",
    description: "Project customers, revenue, costs, and cash for 12, 24, or 36 months and see when the model breaks even.",
  },
  {
    icon: PiggyBank,
    title: "Cash & funding",
    description: "Calculate burn, runway, working capital, funding required, a safety buffer, and founder dilution.",
  },
  {
    icon: SlidersHorizontal,
    title: "Scenarios & uncertainty",
    description: "Compare bear, base, and bull cases, rank sensitive assumptions, and run reproducible Monte Carlo simulations.",
  },
  {
    icon: ShieldAlert,
    title: "Evidence & risk",
    description: "Keep viability separate from confidence, validation maturity, execution readiness, and five risk categories.",
  },
  {
    icon: Gauge,
    title: "A decision, not a vanity score",
    description: "See contradictions, benchmark-backed scores, recommended actions, and the next assumption worth testing.",
  },
];

const WORKFLOW = [
  {
    icon: CheckCircle2,
    title: "Model what you actually know",
    description: "Mark each numeric assumption as known, estimated, or unknown. Add a plausible range when one precise number would be misleading.",
  },
  {
    icon: LineChart,
    title: "Find what changes the outcome",
    description: "Trace core metrics to their formulas, stress-test the forecast, and see which assumptions drive the decision.",
  },
  {
    icon: FileText,
    title: "Turn the analysis into action",
    description: "Reuse the same project to build your one-pager, ICP, offer, validation plan, financial model, MVP scope, GTM plan, sales pack, terms, and pilot report.",
  },
];

const WORKSPACE_FEATURES = [
  {
    icon: GitCompare,
    title: "Compare ideas side by side",
    description: "Save, duplicate, import, export, and compare projects without rebuilding the analysis in a spreadsheet.",
  },
  {
    icon: Bot,
    title: "Bring your AI assistant",
    description: "Use the optional hosted MCP server for scoped project analysis, scenarios, document drafting, and controlled updates.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const t = useAppTranslations();

  async function viewExample() {
    await projectRepository.save(exampleProject);
    router.push(`/project/${exampleProject.id}`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 pt-12 pb-12 text-center sm:pt-20 sm:pb-16">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            {t("Stress-test a business idea before you commit time and capital.")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t("Turn market, pricing, growth, cost, funding, and validation assumptions into transparent economics, uncertainty ranges, and a practical next decision.")}
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button size="lg" className="w-full sm:w-auto" render={<Link href="/new" />}>
              {t("Evaluate an Idea")} <ArrowRight />
            </Button>
            <Button size="lg" className="w-full sm:w-auto" variant="outline" onClick={viewExample}>
              {t("View Example")}
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {t("Open source, available in English and Arabic, with private account-based project access.")}
          </p>
        </section>

        <section className="border-t border-border bg-muted/30 py-12 sm:py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-sm font-semibold tracking-wide text-muted-foreground uppercase">{t("What IdeaUp helps you decide")}</h2>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((item) => (
                <Card key={item.title} size="sm">
                  <CardContent>
                    <item.icon className="size-5 text-primary" />
                    <p className="mt-3 text-sm font-semibold text-foreground">{t(item.title)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t(item.description)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t("From assumptions to a working plan")}</h2>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              {t("One structured project powers the analysis, the decision, and the documents you use to validate, build, sell, and review the business.")}
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {WORKFLOW.map((item) => (
              <Card key={item.title}>
                <CardContent>
                  <item.icon className="size-5 text-primary" />
                  <p className="mt-3 font-semibold text-foreground">{t(item.title)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t(item.description)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-muted/30 py-12 sm:py-16">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 md:grid-cols-2">
            {WORKSPACE_FEATURES.map((item) => (
              <Card key={item.title}>
                <CardContent className="flex gap-4">
                  <item.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold text-foreground">{t(item.title)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t(item.description)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12 text-center sm:py-16">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t("Make the next decision with better evidence.")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            {t("IdeaUp does not predict success. It makes your assumptions, economics, uncertainty, and tradeoffs visible so you know what to fix, validate, or build next.")}
          </p>
          <Button size="lg" className="mt-6 w-full sm:w-auto" render={<Link href="/new" />}>
            {t("Evaluate an Idea")} <ArrowRight />
          </Button>
        </section>
      </main>
    </div>
  );
}
