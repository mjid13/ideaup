"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAppTranslations } from "@/components/i18n/use-app-translations";
import { ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { calculateMetrics, generateScenarios } from "@/lib/calculations";
import { calculateScoreBreakdown } from "@/lib/scoring";
import { generateInsights, generateDecisionSummary } from "@/lib/insights";
import { BUSINESS_MODEL_LABELS } from "@/lib/constants";
import { ScoreHero } from "./ScoreHero";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { KeyMetricsGrid } from "./KeyMetricsGrid";
import { RevenueMixPanel } from "./RevenueMixPanel";
import { InsightsPanel, RecommendedActions } from "./InsightsPanel";
import { DecisionSummary } from "./DecisionSummary";
import { SensitivityPanel } from "./SensitivityPanel";
import { ScenarioTable } from "./ScenarioTable";
import { MonteCarloPanel } from "./MonteCarloPanel";
import { ForecastCharts } from "./ForecastCharts";
import { EfficiencyPanel } from "./EfficiencyPanel";
import { FundingRequirementPanel } from "./FundingRequirementPanel";
import { ExportMenu } from "./ExportMenu";
import { ShareDialog } from "./ShareDialog";
import type { Project } from "@/types";

export function ProjectDashboard({ project }: { project: Project }) {
  const t = useAppTranslations();
  const metrics = useMemo(() => calculateMetrics(project), [project]);
  const scores = useMemo(() => calculateScoreBreakdown(project, metrics), [project, metrics]);
  const insights = useMemo(() => generateInsights(metrics, scores, project), [metrics, scores, project]);
  const decision = useMemo(() => generateDecisionSummary(scores), [scores]);
  const scenarios = useMemo(() => generateScenarios(project, metrics), [project, metrics]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:space-y-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground">{project.basicInfo.name || t("Untitled project")}</h1>
            <Badge variant="secondary">{t(BUSINESS_MODEL_LABELS[project.basicInfo.businessModel])}</Badge>
            {project.viewerAccess && project.viewerAccess !== "owner" && (
              <Badge variant="outline">{project.viewerAccess === "write" ? t("Shared with you • Can edit") : t("Shared with you • Read only")}</Badge>
            )}
          </div>
          {project.basicInfo.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.basicInfo.description}</p>}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {project.viewerAccess !== "read" && (
            <Button variant="outline" size="sm" render={<Link href={`/project/${project.id}/edit`} />}>
              <Pencil /> {t("Edit assumptions")}
            </Button>
          )}
          <ExportMenu project={project} />
          <ShareDialog project={project} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Turn this idea into a business")}</CardTitle>
          <CardDescription>
            {t(
              "Build a Business One-Pager, ICP, Value Proposition, Validation Plan, and more — structured documents filled in automatically from what we've already entered here."
            )}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-end border-t-0 bg-transparent p-(--card-spacing)">
          <Button size="sm" className="w-full sm:w-auto" render={<Link href={`/project/${project.id}/documents`} />}>
            {t("Discover business documents")} <ArrowRight />
          </Button>
        </CardFooter>
      </Card>

      <ScoreHero scores={scores} />
      <ScoreBreakdown scores={scores} />
      <KeyMetricsGrid metrics={metrics} scores={scores} currency={project.basicInfo.currency} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InsightsPanel report={insights} />
        <div className="space-y-6">
          <DecisionSummary summary={decision} />
          <RecommendedActions items={insights.recommendedActions} />
        </div>
      </div>

      <RevenueMixPanel metrics={metrics} currency={project.basicInfo.currency} />
      <FundingRequirementPanel project={project} metrics={metrics} />
      <SensitivityPanel project={project} />
      <EfficiencyPanel project={project} metrics={metrics} />
      <ScenarioTable result={scenarios} currency={project.basicInfo.currency} />
      <MonteCarloPanel project={project} />
      <ForecastCharts project={project} metrics={metrics} />
    </div>
  );
}
