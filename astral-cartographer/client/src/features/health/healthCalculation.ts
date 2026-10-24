import type {
  AnalysisDetails,
  IArchitecturalIssue,
  IAnalysisMetrics,
} from '../../lib/api';
import type { AtlasData, FileNode } from '../atlas/model';
import type {
  HealthScoreResult,
  SeverityLevel,
  SeverityCategoryInfo,
  ComplexityBucket,
  RiskItem,
  RecommendationItem,
  HistoricalTrendPoint,
} from './healthTypes';

/**
 * Transparent, documented mapping from backend issues to standard 4-tier architectural severity levels.
 *
 * 1. Critical: Eager circular dependencies (break module evaluation order at runtime, cause undefined imports).
 * 2. High: High coupling (hub modules with fan-out > 12 or fan-in > 15, major maintenance bottleneck).
 * 3. Medium: Oversized modules (> 500 lines or > 25 functions, violation of Single Responsibility Principle).
 * 4. Low: Deep relative import nesting (../../..) or type-only/dynamic circular dependencies (lazy, non-crashing).
 */
export function classifyIssueSeverity(issue: IArchitecturalIssue): SeverityLevel {
  if (issue.type === 'circular_dependency') {
    return issue.severity === 'error' ? 'critical' : 'low';
  }
  if (issue.type === 'high_coupling') {
    return 'high';
  }
  if (issue.type === 'oversized_file') {
    return 'medium';
  }
  if (issue.type === 'deep_import_nesting') {
    return 'low';
  }
  if (issue.severity === 'error') return 'critical';
  if (issue.severity === 'warning') return 'medium';
  return 'low';
}

export function getIssuesBySeverity(
  issues: IArchitecturalIssue[]
): Record<SeverityLevel, SeverityCategoryInfo> {
  const buckets: Record<SeverityLevel, SeverityCategoryInfo> = {
    critical: {
      id: 'critical',
      label: 'Critical',
      count: 0,
      color: '#FF717A',
      dotColor: '#FF717A',
      issues: [],
    },
    high: {
      id: 'high',
      label: 'High',
      count: 0,
      color: '#FFAD66',
      dotColor: '#FFAD66',
      issues: [],
    },
    medium: {
      id: 'medium',
      label: 'Medium',
      count: 0,
      color: '#FFD166',
      dotColor: '#FFD166',
      issues: [],
    },
    low: {
      id: 'low',
      label: 'Low',
      count: 0,
      color: '#38BDF8',
      dotColor: '#38BDF8',
      issues: [],
    },
  };

  for (const issue of issues) {
    const sev = classifyIssueSeverity(issue);
    buckets[sev].count++;
    buckets[sev].issues.push(issue);
  }

  return buckets;
}

/**
 * Derives a reproducible architectural health score (0 - 100) based on verified findings and coverage.
 *
 * Logic:
 * - Base score: 100
 * - Deductions per Critical finding: -12 pts (max -36)
 * - Deductions per High finding: -5 pts (max -25)
 * - Deductions per Medium finding: -3 pts (max -18)
 * - Deductions per Low finding: -1 pt (max -10)
 * - If analysis has not run, is failed, or contains 0 files: score is null (unavailable).
 */
export function calculateHealthScore(
  analysis: AnalysisDetails | null,
  atlas: AtlasData | null
): HealthScoreResult {
  if (!analysis || !analysis.metrics || analysis.metrics.totalFiles === 0) {
    return {
      score: null,
      status: 'unavailable',
      categoryLabel: 'N/A',
      headline: 'Score Unavailable',
      explanation: 'Analysis has not completed or no repository files were analyzed.',
      breakdown: {
        healthyPercent: 0,
        needsAttentionPercent: 0,
        criticalPercent: 0,
      },
      deductions: [],
    };
  }

  const issues = analysis.issues || [];
  const categorized = getIssuesBySeverity(issues);

  const criticalDeduction = Math.min(36, categorized.critical.count * 12);
  const highDeduction = Math.min(25, categorized.high.count * 5);
  const mediumDeduction = Math.min(18, categorized.medium.count * 3);
  const lowDeduction = Math.min(10, categorized.low.count * 1);

  const deductions = [
    { label: `${categorized.critical.count} Critical Issues`, points: criticalDeduction },
    { label: `${categorized.high.count} High Issues`, points: highDeduction },
    { label: `${categorized.medium.count} Medium Issues`, points: mediumDeduction },
    { label: `${categorized.low.count} Low Issues`, points: lowDeduction },
  ].filter((d) => d.points > 0);

  const totalDeductions = criticalDeduction + highDeduction + mediumDeduction + lowDeduction;
  const rawScore = Math.max(0, Math.min(100, Math.round(100 - totalDeductions)));

  // Coverage assessment
  const coverage = analysis.metrics.coverage;
  const codeFiles = coverage?.codeFiles ?? analysis.metrics.totalFiles;
  const analyzedFiles = coverage?.analyzedCodeFiles ?? (analysis.files ? analysis.files.length : codeFiles);

  let coverageNotice: string | undefined;
  if (coverage?.completeness === 'partial' || (codeFiles > 0 && analyzedFiles < codeFiles)) {
    coverageNotice = `Analysis ran on ${analyzedFiles} of ${codeFiles} code files (${Math.round(
      (analyzedFiles / Math.max(1, codeFiles)) * 100
    )}% coverage). Non-AST languages receive approximate function/dependency metrics.`;
  }

  // Calculate file breakdown percentages
  const filesWithIssues = new Set<string>();
  const filesWithCriticalOrHigh = new Set<string>();
  const filesWithMediumOrLow = new Set<string>();

  for (const issue of issues) {
    const sev = classifyIssueSeverity(issue);
    filesWithIssues.add(issue.file);
    if (sev === 'critical' || sev === 'high') {
      filesWithCriticalOrHigh.add(issue.file);
    } else {
      filesWithMediumOrLow.add(issue.file);
    }
  }

  const totalEvaluated = Math.max(1, analyzedFiles);
  const critCount = filesWithCriticalOrHigh.size;
  const medLowOnlyCount = [...filesWithMediumOrLow].filter((f) => !filesWithCriticalOrHigh.has(f)).length;
  const healthyCount = Math.max(0, totalEvaluated - (critCount + medLowOnlyCount));

  let healthyPercent = Math.round((healthyCount / totalEvaluated) * 100);
  let criticalPercent = Math.round((critCount / totalEvaluated) * 100);
  let needsAttentionPercent = Math.round((medLowOnlyCount / totalEvaluated) * 100);

  // Normalize so they sum to 100
  const sum = healthyPercent + criticalPercent + needsAttentionPercent;
  if (sum !== 100 && sum > 0) {
    healthyPercent += 100 - sum;
  }

  if (rawScore >= 80) {
    return {
      score: rawScore,
      status: 'healthy',
      categoryLabel: 'Good',
      headline: 'Your codebase is healthy!',
      explanation: 'Well-structured with modular boundaries and low architectural risk.',
      coverageNotice,
      breakdown: { healthyPercent, needsAttentionPercent, criticalPercent },
      deductions,
    };
  }

  if (rawScore >= 65) {
    return {
      score: rawScore,
      status: 'good',
      categoryLabel: 'Fair',
      headline: 'Codebase structure is fair',
      explanation: 'Generally sound architecture with localized coupling or oversized modules.',
      coverageNotice,
      breakdown: { healthyPercent, needsAttentionPercent, criticalPercent },
      deductions,
    };
  }

  if (rawScore >= 50) {
    return {
      score: rawScore,
      status: 'attention',
      categoryLabel: 'Needs Attention',
      headline: 'Architectural attention recommended',
      explanation: 'Multiple high coupling hubs or large modules detected across the project.',
      coverageNotice,
      breakdown: { healthyPercent, needsAttentionPercent, criticalPercent },
      deductions,
    };
  }

  return {
    score: rawScore,
    status: 'critical',
    categoryLabel: 'Critical',
    headline: 'Action needed on architectural risks',
    explanation: 'Circular dependencies or excessive coupling require refactoring.',
    coverageNotice,
    breakdown: { healthyPercent, needsAttentionPercent, criticalPercent },
    deductions,
  };
}

/**
 * Buckets code complexity into 5 standard ranges: Very Low, Low, Medium, High, Very High.
 * Uses Babel AST cyclomatic decision points if atlas is loaded, or function count/lines fallback.
 */
export function calculateComplexityBuckets(
  atlas: AtlasData | null,
  analysis: AnalysisDetails | null
): ComplexityBucket[] {
  const buckets: ComplexityBucket[] = [
    { label: 'Very Low', range: '1 - 5', count: 0, color: '#43D9A3', files: [] },
    { label: 'Low', range: '6 - 15', count: 0, color: '#38BDF8', files: [] },
    { label: 'Medium', range: '16 - 30', count: 0, color: '#FFD166', files: [] },
    { label: 'High', range: '31 - 50', count: 0, color: '#FFAD66', files: [] },
    { label: 'Very High', range: '51+', count: 0, color: '#FF717A', files: [] },
  ];

  if (atlas && atlas.files && atlas.files.length > 0) {
    const codeFiles = atlas.files.filter((f) => f.kind === 'code');
    for (const f of codeFiles) {
      const comp = f.complexity !== undefined ? f.complexity : Math.max(1, f.functions.length * 2);
      const entry = { path: f.path, complexity: comp, lines: f.lines };

      if (comp <= 5) buckets[0].files.push(entry);
      else if (comp <= 15) buckets[1].files.push(entry);
      else if (comp <= 30) buckets[2].files.push(entry);
      else if (comp <= 50) buckets[3].files.push(entry);
      else buckets[4].files.push(entry);
    }
  } else if (analysis && analysis.files && analysis.files.length > 0) {
    for (const f of analysis.files) {
      const fns = f.functionCount ?? 1;
      const entry = { path: f.path, complexity: fns, lines: 0 };

      if (fns <= 5) buckets[0].files.push(entry);
      else if (fns <= 15) buckets[1].files.push(entry);
      else if (fns <= 30) buckets[2].files.push(entry);
      else if (fns <= 50) buckets[3].files.push(entry);
      else buckets[4].files.push(entry);
    }
  }

  for (const b of buckets) {
    b.count = b.files.length;
  }

  return buckets;
}

/**
 * Prioritized risk items for the Top Risk Areas card.
 */
export function deriveRiskAreas(analysis: AnalysisDetails | null): RiskItem[] {
  if (!analysis || !analysis.issues) return [];

  const items: RiskItem[] = [];
  const sevWeight: Record<SeverityLevel, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  for (const issue of analysis.issues) {
    const severity = classifyIssueSeverity(issue);
    items.push({
      id: issue.id || `${issue.type}-${issue.file}-${issue.line}`,
      filePath: issue.file,
      severity,
      confidence: issue.confidence || 'heuristic',
      title: issue.rule,
      description: issue.description,
      rule: issue.rule,
      line: issue.line,
      affectedFiles: issue.affectedFiles,
    });
  }

  items.sort((a, b) => sevWeight[a.severity] - sevWeight[b.severity] || a.filePath.localeCompare(b.filePath));
  return items;
}

/**
 * Practical, actionable recommendations derived strictly from real repository findings and metrics.
 */
export function deriveRecommendations(
  analysis: AnalysisDetails | null,
  atlas: AtlasData | null
): RecommendationItem[] {
  if (!analysis) return [];

  const issues = analysis.issues || [];
  const recs: RecommendationItem[] = [];

  // 1. Circular Dependencies
  const circularIssues = issues.filter((i) => i.type === 'circular_dependency');
  if (circularIssues.length > 0) {
    const eagerCycles = circularIssues.filter((i) => i.severity === 'error');
    const affected = [...new Set(circularIssues.flatMap((i) => [i.file, ...(i.affectedFiles || [])]))];
    const topFolders = [...new Set(affected.map((p) => p.split('/')[0]))].slice(0, 2);

    recs.push({
      id: 'rec-circular',
      tone: 'red',
      title: 'Reduce circular dependencies',
      subtitle: `${circularIssues.length} circular dependency ${
        circularIssues.length === 1 ? 'group' : 'groups'
      } detected, mainly in ${topFolders.join('/') || 'components'}.`,
      whyItMatters:
        'Circular module dependencies interfere with tree-shaking, create runtime undefined imports upon initialization, and make unit testing isolated modules difficult.',
      evidence: [
        `${circularIssues.length} mutual dependency cycles found in the resolved import graph.`,
        eagerCycles.length > 0
          ? `${eagerCycles.length} cycle(s) occur eagerly at module evaluation time.`
          : 'Cycles occur via lazy or type-only imports.',
      ],
      supportingFiles: affected.slice(0, 8).map((p) => ({ path: p })),
      nextSteps: [
        'Extract shared interfaces, types, or utilities into a separate, lower-level module.',
        'Use dependency inversion or event callbacks instead of mutual imports.',
        'Convert runtime circular imports to dynamic imports where appropriate.',
      ],
      confidence: 'confirmed',
    });
  }

  // 2. Oversized Files
  const oversizedIssues = issues.filter((i) => i.type === 'oversized_file');
  if (oversizedIssues.length > 0) {
    recs.push({
      id: 'rec-oversized',
      tone: 'amber',
      title: 'Consider splitting large files',
      subtitle: `${oversizedIssues.length} ${
        oversizedIssues.length === 1 ? 'file exceeds' : 'files exceed'
      } 500 lines. Consider breaking them into smaller modules.`,
      whyItMatters:
        'Very large modules tend to accumulate multiple unrelated responsibilities, increasing regression risks and cognitive load for code reviewers.',
      evidence: oversizedIssues.slice(0, 4).map((i) => i.description),
      supportingFiles: oversizedIssues.slice(0, 6).map((i) => ({ path: i.file, line: i.line })),
      nextSteps: [
        'Identify distinct sub-responsibilities or helper logic within the module.',
        'Extract reusable UI sub-components into separate files in the same directory.',
        'Extract business logic or state manipulation into dedicated custom hooks or utilities.',
      ],
      confidence: 'heuristic',
    });
  }

  // 3. High Coupling
  const couplingIssues = issues.filter((i) => i.type === 'high_coupling');
  if (couplingIssues.length > 0) {
    recs.push({
      id: 'rec-coupling',
      tone: 'blue',
      title: 'Decouple high-traffic hub modules',
      subtitle: `${couplingIssues.length} ${
        couplingIssues.length === 1 ? 'module has' : 'modules have'
      } high fan-in or fan-out exceeding recommended thresholds.`,
      whyItMatters:
        'Hub modules that connect to too many other files create ripple effects: a single modification can inadvertently break multiple dependent features.',
      evidence: couplingIssues.slice(0, 3).map((i) => i.description),
      supportingFiles: couplingIssues.slice(0, 5).map((i) => ({ path: i.file })),
      nextSteps: [
        'Group related exports behind a clean facade or index interface.',
        'Segregate shared utilities by domain instead of placing everything in a monolith file.',
      ],
      confidence: 'heuristic',
    });
  }

  // 4. Deep Relative Imports
  const deepImportIssues = issues.filter((i) => i.type === 'deep_import_nesting');
  if (deepImportIssues.length > 0) {
    recs.push({
      id: 'rec-deep-imports',
      tone: 'blue',
      title: 'Configure path aliases for cleaner hierarchy',
      subtitle: `${deepImportIssues.length} imports climb 3 or more directory levels (e.g. "../../../").`,
      whyItMatters:
        'Deep relative paths are fragile when files are reorganized and obscure the architectural layer being referenced.',
      evidence: deepImportIssues.slice(0, 3).map((i) => `${i.file}: ${i.description}`),
      supportingFiles: deepImportIssues.slice(0, 4).map((i) => ({ path: i.file, line: i.line })),
      nextSteps: [
        'Configure path aliases in tsconfig.json / jsconfig.json (e.g. "@/*" pointing to "src/*").',
        'Update deep relative imports to use the cleaner root alias.',
      ],
      confidence: 'heuristic',
    });
  }

  // 5. Positive Health Assessment
  if (circularIssues.length === 0 && couplingIssues.length === 0) {
    recs.push({
      id: 'rec-clean-structure',
      tone: 'green',
      title: 'Good modular structure',
      subtitle: 'No circular dependency cycles or excessive module coupling detected.',
      whyItMatters:
        'A clean directed acyclic dependency graph ensures reliable builds, fast tree-shaking, and clear architectural boundaries.',
      evidence: [
        '0 circular dependency findings in internal module graph.',
        'All resolved import dependencies follow hierarchical layering.',
      ],
      supportingFiles: [],
      nextSteps: [
        'Maintain clean module boundaries as new features are added.',
        'Run architectural checks in CI/CD before merging major refactors.',
      ],
      confidence: 'confirmed',
    });
  }

  return recs;
}

/**
 * Extracts historical trend points from the repository's past analyses.
 */
export function deriveHistoricalTrends(
  history: Array<any>
): HistoricalTrendPoint[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const points: HistoricalTrendPoint[] = [];

  for (const h of history) {
    if (h.status !== 'completed' || !h.createdAt) continue;

    const date = new Date(h.createdAt);
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const totalFiles = h.metrics?.totalFiles ?? 0;
    const issuesCount = h.metrics?.architecturalIssues ?? 0;

    // Approximated health score based on historical issue count
    const deduction = Math.min(60, issuesCount * 4);
    const healthScore = Math.max(20, Math.min(100, 100 - deduction));

    points.push({
      id: h._id || h.createdAt,
      date: h.createdAt,
      label,
      commitSha: h.commitSha,
      totalFiles,
      issuesCount,
      healthScore,
    });
  }

  // Oldest first for the line chart
  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return points;
}
