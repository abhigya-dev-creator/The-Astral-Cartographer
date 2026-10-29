import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDynamicRoadmap,
  generateDeterministicFileExplanation,
} from '../services/pathfinder/dynamicLearningService.js';
import type { AtlasData, FileNode, Edge } from '../services/atlas/types.js';

function createMockAtlas(
  files: Array<{ path: string; lines: number; functions?: string[]; exports?: string[] }>,
  edges: Array<[string, string, number?]>
): AtlasData {
  const fileNodes: FileNode[] = files.map((f) => {
    const name = f.path.split('/').pop() || f.path;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    return {
      path: f.path,
      name,
      ext,
      folder: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '',
      size: f.lines * 25,
      lines: f.lines,
      kind: 'code',
      functions: (f.functions || []).map((fn, idx) => ({ name: fn, line: (idx + 1) * 10, kind: 'function' })),
      exports: f.exports || [],
    };
  });

  const edgeNodes: Edge[] = edges.map(([from, to, line]) => ({
    from,
    to,
    specifier: `./${to}`,
    line: line ?? 1,
    kind: 'import',
    status: 'resolved',
  }));

  return {
    version: 1,
    repo: {
      owner: 'testOwner',
      name: 'dynamicRepo',
      branch: 'main',
      commitSha: '1111111111111111111111111111111111111111',
      analyzedAt: new Date().toISOString(),
      source: 'github',
    },
    files: fileNodes,
    edges: edgeNodes,
    cycles: [],
    stats: {
      files: fileNodes.length,
      edges: edgeNodes.length,
      unresolved: 0,
      parseErrors: 0,
      skipped: [],
    },
  };
}

test('dynamic learning roadmap: dynamically identifies entry points and assigns 5 stages based on graph topology without hardcoded names', () => {
  // Arbitrary custom names: AlphaBoot, GammaType, BetaWorker, DeltaRouter, EpsilonHelper
  const atlas = createMockAtlas(
    [
      { path: 'src/AlphaBoot.ts', lines: 50, functions: ['bootSystem'], exports: ['bootSystem'] },
      { path: 'src/DeltaRouter.ts', lines: 80, functions: ['routeDispatch'], exports: ['dispatch'] },
      { path: 'src/BetaWorker.ts', lines: 120, functions: ['processData', 'computeMetrics'], exports: ['processData'] },
      { path: 'src/GammaType.ts', lines: 40, functions: [], exports: ['UserEntity', 'RecordState'] },
      { path: 'src/EpsilonHelper.ts', lines: 30, functions: ['formatStr'], exports: ['formatStr'] },
    ],
    [
      ['src/AlphaBoot.ts', 'src/DeltaRouter.ts', 5],
      ['src/DeltaRouter.ts', 'src/BetaWorker.ts', 10],
      ['src/BetaWorker.ts', 'src/GammaType.ts', 2],
      ['src/DeltaRouter.ts', 'src/GammaType.ts', 3],
      ['src/BetaWorker.ts', 'src/EpsilonHelper.ts', 15],
    ]
  );

  const roadmap = generateDynamicRoadmap(atlas);

  assert.equal(roadmap.repositoryName, 'dynamicRepo');
  assert.equal(roadmap.stages.length, 5);

  // Stage 1 (Entry Points & Roots) should contain AlphaBoot (0 in-degree, >0 out-degree)
  const stage1 = roadmap.stages.find((s) => s.id === 1)!;
  assert.equal(stage1.files.length, 1);
  assert.equal(stage1.files[0].path, 'src/AlphaBoot.ts');
  assert.equal(stage1.files[0].fanIn, 0);
  assert.equal(stage1.files[0].fanOut, 1);
  assert.match(stage1.files[0].rationale, /execution entry point/);

  // Stage 2 (Core Data Models & Shared Types) should contain GammaType (fanIn = 2, fanOut = 0)
  const stage2 = roadmap.stages.find((s) => s.id === 2)!;
  assert.ok(stage2.files.some((f) => f.path === 'src/GammaType.ts'));
  const gamma = stage2.files.find((f) => f.path === 'src/GammaType.ts')!;
  assert.equal(gamma.fanIn, 2);
  assert.equal(gamma.fanOut, 0);

  // Stage 4 (Orchestration & Controllers) should contain DeltaRouter (called by entry point)
  const stage4 = roadmap.stages.find((s) => s.id === 4)!;
  assert.ok(stage4.files.some((f) => f.path === 'src/DeltaRouter.ts'));

  // Stage 3 (Business Logic & Domain Services) should contain BetaWorker (intermediate node)
  const stage3 = roadmap.stages.find((s) => s.id === 3)!;
  assert.ok(stage3.files.some((f) => f.path === 'src/BetaWorker.ts'));

  // Stage 5 (Supporting Modules) should contain EpsilonHelper
  const stage5 = roadmap.stages.find((s) => s.id === 5)!;
  assert.ok(stage5.files.some((f) => f.path === 'src/EpsilonHelper.ts'));
});

test('dynamic learning roadmap: handles circular dependencies without crashing', () => {
  const atlas = createMockAtlas(
    [
      { path: 'pkg/LoopA.py', lines: 60, functions: ['fnA'] },
      { path: 'pkg/LoopB.py', lines: 70, functions: ['fnB'] },
    ],
    [
      ['pkg/LoopA.py', 'pkg/LoopB.py', 5],
      ['pkg/LoopB.py', 'pkg/LoopA.py', 10],
    ]
  );
  atlas.cycles = [['pkg/LoopA.py', 'pkg/LoopB.py']];

  const roadmap = generateDynamicRoadmap(atlas);
  assert.equal(roadmap.metrics.cyclicFilesCount, 2);
  assert.equal(roadmap.learningFilesCount, 2);
  const allLearningFiles = roadmap.stages.flatMap((s) => s.files);
  for (const f of allLearningFiles) {
    assert.equal(f.inCycle, true);
  }
});

test('dynamic learning roadmap: gracefully ranks repositories with 0 dependency links', () => {
  const atlas = createMockAtlas(
    [
      { path: 'scripts/largeScript.go', lines: 500, functions: ['main', 'executeWorker'] },
      { path: 'scripts/smallScript.go', lines: 40, functions: ['helper'] },
    ],
    []
  );

  const roadmap = generateDynamicRoadmap(atlas);
  assert.equal(roadmap.learningFilesCount, 2);
  const files = roadmap.stages.flatMap((s) => s.files);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'scripts/largeScript.go');
});

test('file explanation engine: produces all 7 mandatory sections with code-grounded quizzes', () => {
  const atlas = createMockAtlas(
    [
      { path: 'core/Service.java', lines: 150, functions: ['processPayment', 'verifyCard'], exports: ['PaymentService'] },
      { path: 'core/Controller.java', lines: 80, functions: ['handlePost'] },
    ],
    [['core/Controller.java', 'core/Service.java', 12]]
  );

  const serviceNode = atlas.files.find((f) => f.path === 'core/Service.java')!;
  const explanation = generateDeterministicFileExplanation(serviceNode, atlas);

  // 1. Overview
  assert.equal(explanation.filePath, 'core/Service.java');
  assert.equal(explanation.overview.primaryLanguage, 'Java');
  assert.equal(explanation.overview.functionCount, 2);
  assert.match(explanation.overview.purpose, /processPayment/);

  // 2. Code Walkthrough
  assert.ok(explanation.codeWalkthrough.length >= 2);
  const fnWalkthrough = explanation.codeWalkthrough.find((w) => w.sectionTitle.includes('Functions'));
  assert.ok(fnWalkthrough);
  assert.ok(fnWalkthrough!.keyItems.some((k) => k.includes('processPayment')));

  // 3. Execution Flow
  assert.equal(explanation.executionFlow.incomingCallers.length, 1);
  assert.equal(explanation.executionFlow.incomingCallers[0].callerPath, 'core/Controller.java');
  assert.equal(explanation.executionFlow.incomingCallers[0].line, 12);
  assert.equal(explanation.executionFlow.incomingCallers[0].status, 'confirmed_import');

  // 4. Dependencies
  assert.ok(explanation.dependencies.internal.some((d) => d.path === 'core/Controller.java' && d.relation === 'imported_by'));

  // 5. Architectural Role
  assert.ok(explanation.architecturalRole.layer);
  assert.ok(explanation.architecturalRole.systemImpact.includes('impacts 1 importing module'));

  // 6. Key Concepts
  assert.ok(explanation.keyConcepts.length > 0);

  // 7. Learning Check
  assert.ok(explanation.learningCheck.length >= 2);
  const qFn = explanation.learningCheck.find((q) => q.question.includes('function'));
  assert.ok(qFn);
  assert.equal(qFn!.options[qFn!.correctIndex], 'processPayment');
});
