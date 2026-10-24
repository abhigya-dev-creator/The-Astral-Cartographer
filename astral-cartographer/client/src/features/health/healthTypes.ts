import type { IArchitecturalIssue, ICoverageRule, IAnalysisLanguage } from '../../lib/api';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface SeverityCategoryInfo {
  id: SeverityLevel;
  label: string;
  count: number;
  color: string;
  dotColor: string;
  issues: IArchitecturalIssue[];
}

export interface HealthScoreResult {
  score: number | null;
  status: 'healthy' | 'good' | 'fair' | 'attention' | 'critical' | 'unavailable';
  categoryLabel: string;
  headline: string;
  explanation: string;
  coverageNotice?: string;
  breakdown: {
    healthyPercent: number;
    needsAttentionPercent: number;
    criticalPercent: number;
  };
  deductions: Array<{ label: string; points: number }>;
}

export interface ComplexityBucket {
  label: string;
  range: string;
  count: number;
  color: string;
  files: Array<{ path: string; complexity: number; lines: number }>;
}

export interface RiskItem {
  id: string;
  filePath: string;
  severity: SeverityLevel;
  confidence: 'confirmed' | 'heuristic';
  title: string;
  description: string;
  rule: string;
  line?: number;
  affectedFiles?: string[];
}

export interface RecommendationItem {
  id: string;
  tone: 'red' | 'amber' | 'blue' | 'green';
  title: string;
  subtitle: string;
  whyItMatters: string;
  evidence: string[];
  supportingFiles: Array<{ path: string; line?: number }>;
  nextSteps: string[];
  confidence: 'confirmed' | 'heuristic';
}

export interface HistoricalTrendPoint {
  id: string;
  date: string;
  label: string;
  commitSha?: string;
  totalFiles: number;
  issuesCount: number;
  healthScore: number;
}
