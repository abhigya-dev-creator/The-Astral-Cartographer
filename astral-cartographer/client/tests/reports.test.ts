import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompactNumber,
  getRelativeTimeString,
  calculateKpis,
  calculateCodebaseComposition,
  calculateProjectStructure,
  calculateKeyMetricsSeries,
  deriveBenchmarkData,
  deriveReportInsights,
} from '../src/features/reports/reportsCalculation';
import type { AnalysisDetails, RepositorySummary } from '../src/lib/api';
import type { AtlasData } from '../src/features/atlas/model';

test('reports: formatCompactNumber converts numbers to readable compact notation', () => {
  assert.equal(formatCompactNumber(null), 'N/A');
  assert.equal(formatCompactNumber(undefined), 'N/A');
  assert.equal(formatCompactNumber(0), '0');
  assert.equal(formatCompactNumber(450), '450');
  assert.equal(formatCompactNumber(2413), '2.4K');
  assert.equal(formatCompactNumber(542000), '542K');
  assert.equal(formatCompactNumber(1200000), '1.2M');
});

test('reports: getRelativeTimeString formats past dates accurately', () => {
  assert.equal(getRelativeTimeString(null), 'Recently');
  const now = new Date();
  assert.equal(getRelativeTimeString(now.toISOString()), 'Just now');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  assert.equal(getRelativeTimeString(twoDaysAgo.toISOString()), '2 days ago');
});

test('reports: calculateKpis extracts metrics and handles historical comparisons honestly', () => {
  const repo: RepositorySummary = {
    _id: 'repo1',
    userId: 'u1',
    name: 'next.js',
    owner: 'vercel',
    fullName: 'vercel/next.js',
    source: 'github',
    primaryLanguage: 'TypeScript',
    fileCount: 2413,
    analysisStatus: 'completed',
    createdAt: '2026-01-01',
    commitSha: 'a1b2c3d4e5f6',
  };

  const analysis: AnalysisDetails = {
    _id: 'a1',
    repositoryId: 'repo1',
    status: 'completed',
    commitSha: 'a1b2c3d4e5f6',
    metrics: {
      totalFiles: 2413,
      totalLines: 542000,
      functions: 12000,
      dependencies: 1850,
      architecturalIssues: 4,
    },
    languages: [
      { name: 'TypeScript', count: 1890, percentage: 78.4, lines: 425000 },
      { name: 'JavaScript', count: 320, percentage: 12.1, lines: 65000 },
    ],
    files: [],
    issues: [],
    dependencyGraph: [],
  };

  // Case A: No historical snapshots (< 2) -> No fake deltas
  const kpisNoHistory = calculateKpis(repo, analysis, []);
  assert.equal(kpisNoHistory.totalFiles.formatted, '2,413');
  assert.equal(kpisNoHistory.linesOfCode.formatted, '542K');
  assert.equal(kpisNoHistory.totalFiles.delta, undefined);
  assert.equal(kpisNoHistory.latestCommit.shortSha, 'a1b2c3d');
  assert.equal(kpisNoHistory.contributors.formatted, 'N/A');

  // Case B: Valid historical snapshot exists (>= 2) -> Authentic delta
  const history = [
    {
      status: 'completed',
      metrics: { totalFiles: 2413, totalLines: 542000 },
    },
    {
      status: 'completed',
      metrics: { totalFiles: 2154, totalLines: 501850 },
    },
  ];

  const kpisWithHistory = calculateKpis(repo, analysis, history);
  assert.ok(kpisWithHistory.totalFiles.delta);
  assert.equal(kpisWithHistory.totalFiles.delta.direction, 'up');
  assert.equal(kpisWithHistory.totalFiles.delta.percent, 12);
  assert.equal(kpisWithHistory.totalFiles.delta.baselineLabel, 'vs. last analysis');
});

test('reports: calculateCodebaseComposition partitions languages and lines', () => {
  const analysis: AnalysisDetails = {
    _id: 'a1',
    repositoryId: 'repo1',
    status: 'completed',
    metrics: {
      totalFiles: 100,
      totalLines: 10000,
      functions: 200,
      dependencies: 50,
      architecturalIssues: 0,
    },
    languages: [
      { name: 'TypeScript', count: 70, percentage: 70, lines: 7000 },
      { name: 'CSS', count: 30, percentage: 30, lines: 3000 },
    ],
    files: [
      { path: 'src/app.ts', extension: 'ts', size: 500, functionCount: 4, dependencies: [], lineCount: 100, parseStatus: 'parsed' },
      { path: 'src/style.css', extension: 'css', size: 200, functionCount: 0, dependencies: [], lineCount: 50, parseStatus: 'not_code' },
    ],
    issues: [],
    dependencyGraph: [],
  };

  const comp = calculateCodebaseComposition(analysis);
  assert.equal(comp.totalLines, 10000);
  assert.equal(comp.totalFiles, 100);
  assert.equal(comp.items.length, 2);
  assert.equal(comp.items[0].name, 'TypeScript');
  assert.equal(comp.items[0].isSource, true);
  assert.equal(comp.items[1].name, 'CSS');
  assert.equal(comp.items[1].isSource, false);
});

test('reports: calculateProjectStructure groups files by top-level directories', () => {
  const atlas: AtlasData = {
    files: [
      { id: '1', path: 'src/index.ts', name: 'index.ts', folder: 'src', ext: '.ts', size: 100, lines: 50, kind: 'code', language: 'TS', functions: [], exports: [] },
      { id: '2', path: 'src/lib/api.ts', name: 'api.ts', folder: 'src/lib', ext: '.ts', size: 100, lines: 50, kind: 'code', language: 'TS', functions: [], exports: [] },
      { id: '3', path: 'packages/core/main.ts', name: 'main.ts', folder: 'packages/core', ext: '.ts', size: 100, lines: 50, kind: 'code', language: 'TS', functions: [], exports: [] },
      { id: '4', path: 'docs/guide.md', name: 'guide.md', folder: 'docs', ext: '.md', size: 100, lines: 50, kind: 'text', language: 'MD', functions: [], exports: [] },
    ],
    edges: [],
    cycles: [],
    stats: { files: 4, edges: 0, cycles: 0 },
  };

  const structure = calculateProjectStructure(null, atlas);
  assert.ok(structure.length >= 3);
  const srcNode = structure.find((n) => n.name === 'src');
  assert.ok(srcNode);
  assert.equal(srcNode.fileCount, 2);
  assert.equal(srcNode.percentage, 50);
});

test('reports: deriveBenchmarkData prioritizes selected repository and preserves actual metrics', () => {
  const currentRepo: RepositorySummary = {
    _id: 'current-1',
    userId: 'u1',
    name: 'cartographer',
    owner: 'abhigya',
    fullName: 'abhigya/cartographer',
    source: 'github',
    primaryLanguage: 'TypeScript',
    fileCount: 150,
    analysisStatus: 'completed',
    createdAt: '2026-01-01',
  };

  const currentAnalysis: AnalysisDetails = {
    _id: 'a1',
    repositoryId: 'current-1',
    status: 'completed',
    metrics: {
      totalFiles: 150,
      totalLines: 18500,
      functions: 620,
      dependencies: 110,
      architecturalIssues: 2,
    },
    languages: [],
    files: [],
    issues: [],
    dependencyGraph: [],
  };

  const benchmarks = deriveBenchmarkData(currentRepo, currentAnalysis, [currentRepo], true);
  assert.ok(benchmarks.length >= 2);
  const current = benchmarks[0];
  assert.equal(current.isCurrent, true);
  assert.equal(current.name, 'cartographer');
  assert.equal(current.linesOfCode, 18500);
  assert.equal(current.dependencies, 110);
  assert.equal(current.architecturalIssues, 2);

  // Community fields are null rather than fabricated numbers
  assert.equal(current.stars, null);
  assert.equal(current.forks, null);
});

test('reports: deriveReportInsights flags circular dependencies and oversized modules', () => {
  const analysisWithIssues: AnalysisDetails = {
    _id: 'a1',
    repositoryId: 'r1',
    status: 'completed',
    issues: [
      {
        file: 'src/cycleA.ts',
        rule: 'Circular Dependency',
        description: 'Mutual import between cycleA and cycleB',
        severity: 'error',
        type: 'circular_dependency',
      },
      {
        file: 'src/big.ts',
        rule: 'Oversized Module',
        description: 'Module exceeds 700 lines',
        severity: 'warning',
        type: 'oversized_file',
      },
    ],
  };

  const insights = deriveReportInsights(analysisWithIssues, null);
  const circInsight = insights.find((i) => i.id === 'ins-circular');
  assert.ok(circInsight);
  assert.equal(circInsight.type, 'critical');
  assert.equal(circInsight.confidence, 'confirmed');

  const compInsight = insights.find((i) => i.id === 'ins-complexity');
  assert.ok(compInsight);
  assert.equal(compInsight.type, 'warning');
});
