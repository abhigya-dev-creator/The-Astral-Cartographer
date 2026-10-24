import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIssueSeverity,
  getIssuesBySeverity,
  calculateHealthScore,
  calculateComplexityBuckets,
  deriveRiskAreas,
  deriveRecommendations,
  deriveHistoricalTrends,
} from '../src/features/health/healthCalculation';
import type { AnalysisDetails, IArchitecturalIssue } from '../src/lib/api';
import type { AtlasData } from '../src/features/atlas/model';

test('health calculation: classifyIssueSeverity maps rules to 4-tier severity levels', () => {
  const eagerCycle: IArchitecturalIssue = {
    file: 'src/a.ts',
    rule: 'Circular Dependency',
    description: 'Mutual import cycle',
    severity: 'error',
    type: 'circular_dependency',
  };
  assert.equal(classifyIssueSeverity(eagerCycle), 'critical');

  const lazyCycle: IArchitecturalIssue = {
    file: 'src/b.ts',
    rule: 'Circular Dependency',
    description: 'Lazy import cycle',
    severity: 'warning',
    type: 'circular_dependency',
  };
  assert.equal(classifyIssueSeverity(lazyCycle), 'low');

  const highCoupling: IArchitecturalIssue = {
    file: 'src/hub.ts',
    rule: 'High Coupling Hub',
    description: 'Fan-out is 18',
    severity: 'warning',
    type: 'high_coupling',
  };
  assert.equal(classifyIssueSeverity(highCoupling), 'high');

  const oversized: IArchitecturalIssue = {
    file: 'src/huge.ts',
    rule: 'Oversized Module',
    description: '740 lines of code',
    severity: 'warning',
    type: 'oversized_file',
  };
  assert.equal(classifyIssueSeverity(oversized), 'medium');

  const deepNesting: IArchitecturalIssue = {
    file: 'src/a/b/c/deep.ts',
    rule: 'Deep Import Nesting',
    description: 'Import climbs 4 directories',
    severity: 'info',
    type: 'deep_import_nesting',
  };
  assert.equal(classifyIssueSeverity(deepNesting), 'low');
});

test('health calculation: getIssuesBySeverity tallies issues into 4 buckets', () => {
  const issues: IArchitecturalIssue[] = [
    { file: 'a.ts', rule: 'Circular', description: '', severity: 'error', type: 'circular_dependency' },
    { file: 'b.ts', rule: 'Circular', description: '', severity: 'error', type: 'circular_dependency' },
    { file: 'c.ts', rule: 'Coupling', description: '', severity: 'warning', type: 'high_coupling' },
    { file: 'd.ts', rule: 'Oversized', description: '', severity: 'warning', type: 'oversized_file' },
    { file: 'e.ts', rule: 'Deep', description: '', severity: 'info', type: 'deep_import_nesting' },
  ];

  const buckets = getIssuesBySeverity(issues);
  assert.equal(buckets.critical.count, 2);
  assert.equal(buckets.high.count, 1);
  assert.equal(buckets.medium.count, 1);
  assert.equal(buckets.low.count, 1);
  assert.equal(buckets.critical.issues.length, 2);
});

test('health calculation: calculateHealthScore returns unavailable for missing analysis', () => {
  const result = calculateHealthScore(null, null);
  assert.equal(result.score, null);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.categoryLabel, 'N/A');
});

test('health calculation: calculateHealthScore derives score 100 for clean repository', () => {
  const analysis: AnalysisDetails = {
    _id: '1',
    repositoryId: 'repo1',
    status: 'completed',
    metrics: {
      totalFiles: 20,
      totalFunctions: 80,
      totalDependencies: 35,
      dependencyMetrics: {
        totalDependencies: 35,
        internalEdges: 25,
        externalPackages: ['react', 'lodash'],
      },
      coverage: {
        codeFiles: 20,
        analyzedCodeFiles: 20,
        completeness: 'complete',
      },
    },
    issues: [],
    files: [],
  };

  const result = calculateHealthScore(analysis, null);
  assert.equal(result.score, 100);
  assert.equal(result.status, 'healthy');
  assert.equal(result.categoryLabel, 'Good');
  assert.equal(result.breakdown.healthyPercent, 100);
  assert.equal(result.breakdown.criticalPercent, 0);
  assert.equal(result.deductions.length, 0);
});

test('health calculation: calculateHealthScore applies reproducible deductions for issues', () => {
  const analysis: AnalysisDetails = {
    _id: '1',
    repositoryId: 'repo1',
    status: 'completed',
    metrics: {
      totalFiles: 10,
      totalFunctions: 50,
      totalDependencies: 20,
      dependencyMetrics: {
        totalDependencies: 20,
        internalEdges: 15,
        externalPackages: ['react'],
      },
      coverage: {
        codeFiles: 10,
        analyzedCodeFiles: 10,
        completeness: 'complete',
      },
    },
    issues: [
      { file: 'a.ts', rule: 'Circular', description: '', severity: 'error', type: 'circular_dependency' },
      { file: 'b.ts', rule: 'High Coupling', description: '', severity: 'warning', type: 'high_coupling' },
    ],
    files: [
      { path: 'a.ts', name: 'a.ts', extension: '.ts', lineCount: 100, functionCount: 4, imports: [], exports: [] },
      { path: 'b.ts', name: 'b.ts', extension: '.ts', lineCount: 120, functionCount: 6, imports: [], exports: [] },
    ],
  };

  // 1 critical (-12) + 1 high (-5) = -17 deduction -> score 83
  const result = calculateHealthScore(analysis, null);
  assert.equal(result.score, 83);
  assert.equal(result.status, 'healthy');
  assert.equal(result.deductions.length, 2);
  assert.equal(result.breakdown.criticalPercent, 20); // 2 out of 10 files
});

test('health calculation: calculateComplexityBuckets groups files into 5 standard ranges', () => {
  const atlas: AtlasData = {
    files: [
      { id: '1', path: 'vlow.ts', name: 'vlow.ts', folder: 'src', ext: '.ts', size: 100, lines: 20, kind: 'code', language: 'TS', complexity: 3, functions: [], exports: [] },
      { id: '2', path: 'low.ts', name: 'low.ts', folder: 'src', ext: '.ts', size: 200, lines: 50, kind: 'code', language: 'TS', complexity: 12, functions: [], exports: [] },
      { id: '3', path: 'med.ts', name: 'med.ts', folder: 'src', ext: '.ts', size: 300, lines: 100, kind: 'code', language: 'TS', complexity: 22, functions: [], exports: [] },
      { id: '4', path: 'high.ts', name: 'high.ts', folder: 'src', ext: '.ts', size: 400, lines: 200, kind: 'code', language: 'TS', complexity: 45, functions: [], exports: [] },
      { id: '5', path: 'vhigh.ts', name: 'vhigh.ts', folder: 'src', ext: '.ts', size: 500, lines: 400, kind: 'code', language: 'TS', complexity: 80, functions: [], exports: [] },
    ],
    links: [],
  };

  const buckets = calculateComplexityBuckets(atlas, null);
  assert.equal(buckets.length, 5);
  assert.equal(buckets[0].label, 'Very Low');
  assert.equal(buckets[0].count, 1);
  assert.equal(buckets[1].label, 'Low');
  assert.equal(buckets[1].count, 1);
  assert.equal(buckets[2].label, 'Medium');
  assert.equal(buckets[2].count, 1);
  assert.equal(buckets[3].label, 'High');
  assert.equal(buckets[3].count, 1);
  assert.equal(buckets[4].label, 'Very High');
  assert.equal(buckets[4].count, 1);
});

test('health calculation: deriveRiskAreas prioritizes critical and high risks', () => {
  const analysis: AnalysisDetails = {
    _id: '1',
    repositoryId: 'repo1',
    status: 'completed',
    issues: [
      { file: 'src/oversized.ts', rule: 'Oversized', description: '600 lines', severity: 'warning', type: 'oversized_file' },
      { file: 'src/cycle.ts', rule: 'Circular', description: 'eager cycle', severity: 'error', type: 'circular_dependency' },
    ],
  };

  const risks = deriveRiskAreas(analysis);
  assert.equal(risks.length, 2);
  assert.equal(risks[0].filePath, 'src/cycle.ts');
  assert.equal(risks[0].severity, 'critical');
  assert.equal(risks[1].filePath, 'src/oversized.ts');
  assert.equal(risks[1].severity, 'medium');
});

test('health calculation: deriveRecommendations produces actionable advice from findings', () => {
  const analysis: AnalysisDetails = {
    _id: '1',
    repositoryId: 'repo1',
    status: 'completed',
    issues: [
      {
        file: 'src/components/A.tsx',
        rule: 'Circular Dependency',
        description: 'Circular cycle between A and B',
        severity: 'error',
        type: 'circular_dependency',
        affectedFiles: ['src/components/B.tsx'],
      },
    ],
  };

  const recs = deriveRecommendations(analysis, null);
  assert.ok(recs.length >= 1);
  const circRec = recs.find((r) => r.id === 'rec-circular');
  assert.ok(circRec);
  assert.equal(circRec.tone, 'red');
  assert.equal(circRec.confidence, 'confirmed');
  assert.ok(circRec.nextSteps.length > 0);
  assert.ok(circRec.supportingFiles.length > 0);
});

test('health calculation: deriveHistoricalTrends extracts points and handles empty states', () => {
  assert.deepEqual(deriveHistoricalTrends([]), []);
  assert.deepEqual(deriveHistoricalTrends(null as any), []);

  const history = [
    {
      _id: 'h1',
      status: 'completed',
      createdAt: '2026-05-01T10:00:00Z',
      metrics: { totalFiles: 50, architecturalIssues: 4 },
    },
    {
      _id: 'h2',
      status: 'completed',
      createdAt: '2026-06-01T10:00:00Z',
      metrics: { totalFiles: 60, architecturalIssues: 1 },
    },
  ];

  const points = deriveHistoricalTrends(history);
  assert.equal(points.length, 2);
  assert.equal(points[0].id, 'h1');
  assert.equal(points[1].id, 'h2');
  assert.ok(points[1].healthScore > points[0].healthScore);
});
