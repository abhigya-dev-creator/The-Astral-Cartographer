import React from 'react';
import type {
  KpiSummaryData,
  CodebaseCompositionData,
  ProjectStructureNode,
  KeyMetricSeriesItem,
  BenchmarkRepoData,
  ReportInsightItem,
} from './reportsTypes';
import { SummaryKpiRow } from './SummaryKpiRow';
import { CodebaseCompositionCard } from './CodebaseCompositionCard';
import { ProjectStructureCard } from './ProjectStructureCard';
import { KeyMetricsTrendCard } from './KeyMetricsTrendCard';
import { BenchmarksSummaryCard } from './BenchmarksSummaryCard';
import { InsightsListCard } from './InsightsListCard';

interface OverviewTabProps {
  kpis: KpiSummaryData;
  composition: CodebaseCompositionData;
  structureNodes: ProjectStructureNode[];
  keyMetrics: KeyMetricSeriesItem[];
  benchmarks: BenchmarkRepoData[];
  insights: ReportInsightItem[];
  repoId?: string;
  onOpenBenchmarksTab: () => void;
  onOpenDetailedReportTab: () => void;
}

export function OverviewTab({
  kpis,
  composition,
  structureNodes,
  keyMetrics,
  benchmarks,
  insights,
  repoId,
  onOpenBenchmarksTab,
  onOpenDetailedReportTab,
}: OverviewTabProps) {
  return (
    <div className="reports-overview-tab-content">
      {/* 1. Summary KPI Cards (Top 5 cards) */}
      <SummaryKpiRow kpis={kpis} />

      {/* 2. Middle Grid: Composition, Project Structure, Key Metrics */}
      <div className="reports-middle-grid">
        <CodebaseCompositionCard composition={composition} />
        <ProjectStructureCard nodes={structureNodes} repoId={repoId} />
        <KeyMetricsTrendCard metrics={keyMetrics} />
      </div>

      {/* 3. Bottom Grid: Benchmarks (60%) & Insights (40%) */}
      <div className="reports-bottom-grid">
        <BenchmarksSummaryCard
          benchmarks={benchmarks}
          onOpenFullBenchmarks={onOpenBenchmarksTab}
        />
        <InsightsListCard
          insights={insights}
          onViewAll={onOpenDetailedReportTab}
        />
      </div>
    </div>
  );
}
