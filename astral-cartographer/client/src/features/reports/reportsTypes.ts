import type { AnalysisDetails, RepositorySummary, IArchitecturalIssue, IAnalysisLanguage } from '../../lib/api';

export type ReportTabId = 'overview' | 'benchmarks' | 'detailed' | 'export';

export interface MetricDelta {
  percent: number;
  direction: 'up' | 'down' | 'same';
  baselineLabel: string;
}

export interface KpiSummaryData {
  totalFiles: {
    value: number;
    formatted: string;
    delta?: MetricDelta;
  };
  linesOfCode: {
    value: number;
    formatted: string;
    delta?: MetricDelta;
  };
  contributors: {
    value: number | null;
    formatted: string;
    source: 'github' | 'unavailable';
    sourceLabel: string;
    delta?: MetricDelta;
  };
  languages: {
    primaryName: string;
    primaryPercent: number;
    segments: Array<{
      name: string;
      percentage: number;
      color: string;
    }>;
  };
  latestCommit: {
    sha?: string | null;
    shortSha?: string | null;
    formattedDate: string;
    relativeDate: string;
    githubUrl?: string | null;
  };
}

export interface CodebaseCompositionData {
  totalLines: number;
  totalFiles: number;
  sourceFilesCount: number;
  nonSourceFilesCount: number;
  items: Array<{
    name: string;
    percentage: number;
    lines: number;
    files: number;
    color: string;
    isSource: boolean;
  }>;
}

export interface ProjectStructureNode {
  name: string;
  path: string;
  fileCount: number;
  lines: number;
  percentage: number;
  color: string;
}

export interface KeyMetricSeriesItem {
  id: string;
  label: string;
  value: string;
  rawValue: number | null;
  color: string;
  iconName: 'commits' | 'pull_requests' | 'issues_opened' | 'issues_closed' | 'functions' | 'dependencies';
  sparkline: number[];
  source: 'github_metadata' | 'code_analysis';
  sourceNote: string;
}

export interface BenchmarkRepoData {
  id: string;
  name: string;
  fullName: string;
  isCurrent: boolean;
  isReferenceBenchmark?: boolean;
  stars: number | null;
  forks: number | null;
  contributors: number | null;
  linesOfCode: number | null;
  openIssues: number | null;
  closedIssues: number | null;
  dependencies: number | null;
  architecturalIssues: number | null;
  fileCount: number | null;
  primaryLanguage: string;
}

export interface ReportInsightItem {
  id: string;
  type: 'positive' | 'warning' | 'critical' | 'suggestion';
  title: string;
  description: string;
  whyItMatters: string;
  involvedFiles: string[];
  confidence: 'confirmed' | 'heuristic';
  suggestedNextStep: string;
  linkTo?: string;
  linkLabel?: string;
}

export interface ExportOptions {
  includeExecutiveSummary: boolean;
  includeKeyMetrics: boolean;
  includeComposition: boolean;
  includeStructure: boolean;
  includeFindings: boolean;
  includeBenchmarks: boolean;
}
