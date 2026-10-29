import type { AtlasData, FileNode, Edge } from '../atlas/types.js';
import axios from 'axios';

export interface DynamicLearningFile {
  path: string;
  name: string;
  ext: string;
  folder: string;
  lines: number;
  size: number;
  language: string;
  stageId: number;
  stageName: string;
  rank: number;
  importance: 'Critical' | 'High' | 'Medium' | 'Supporting';
  rationale: string;
  fanIn: number;
  fanOut: number;
  prerequisites: Array<{ path: string; name: string; line?: number; reason: string }>;
  dependents: Array<{ path: string; name: string; line?: number }>;
  externalPackages: string[];
  functions: Array<{ name: string; line: number; kind: string }>;
  exports: string[];
  complexity?: number;
  inCycle: boolean;
}

export interface LearningStage {
  id: number;
  name: string;
  description: string;
  color: string;
  files: DynamicLearningFile[];
}

export interface DynamicRoadmapResult {
  repositoryName: string;
  totalAnalyzedFiles: number;
  learningFilesCount: number;
  stages: LearningStage[];
  entryPointsCount: number;
  languages: string[];
  metrics: {
    totalDependencies: number;
    cyclicFilesCount: number;
  };
}

export interface FileExplanation {
  filePath: string;
  overview: {
    purpose: string;
    whyExists: string;
    tier: string;
    linesOfCode: number;
    primaryLanguage: string;
    exportCount: number;
    functionCount: number;
  };
  codeWalkthrough: Array<{
    sectionTitle: string;
    startLine: number;
    endLine?: number;
    description: string;
    keyItems: string[];
  }>;
  executionFlow: {
    incomingCallers: Array<{
      callerPath: string;
      line: number;
      description: string;
      status: 'confirmed_import' | 'inferred';
    }>;
    outgoingCalls: Array<{
      targetPath: string;
      line: number;
      description: string;
      status: 'confirmed_import' | 'inferred';
    }>;
    lifecycleSummary: string;
  };
  dependencies: {
    internal: Array<{ path: string; relation: 'imports' | 'imported_by'; line?: number }>;
    external: string[];
    dependencyHealth: 'healthy' | 'cyclic' | 'high_coupling';
  };
  architecturalRole: {
    layer: string;
    connectivityScore: number;
    systemImpact: string;
  };
  keyConcepts: Array<{
    concept: string;
    explanation: string;
    contextInCode: string;
  }>;
  learningCheck: Array<{
    id: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

const TEST_REGEX = /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests?\.java$|(^|\/)src\/test\//i;

export function isTestFilePath(path: string): boolean {
  return TEST_REGEX.test(path);
}

const LANGUAGE_EXT_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.kt': 'Kotlin',
  '.php': 'PHP',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.cpp': 'C++',
  '.c': 'C',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.json': 'JSON',
};

export function getFileLanguage(ext: string): string {
  const normalized = ext.toLowerCase();
  return LANGUAGE_EXT_MAP[normalized] || (ext ? ext.replace(/^\./, '').toUpperCase() : 'Plain Text');
}

/**
 * Pure algorithm: analyzes repository graph topology to construct a dynamic,
 * personalized learning roadmap without any hardcoded filename or framework assumptions.
 */
export function generateDynamicRoadmap(atlas: AtlasData, analysis?: any): DynamicRoadmapResult {
  const allFiles = atlas.files || [];
  const edges = atlas.edges || [];
  const cycleSet = new Set<string>();
  for (const c of atlas.cycles || []) {
    for (const f of c) cycleSet.add(f);
  }

  // 1. Filter out tests and non-code / asset files
  const candidateFiles = allFiles.filter((f) => {
    if (f.kind !== 'code') return false;
    if (isTestFilePath(f.path)) return false;
    return true;
  });

  const fileMap = new Map<string, FileNode>();
  for (const f of candidateFiles) fileMap.set(f.path, f);

  // 2. Build graph adjacency structures
  const inDegreeMap = new Map<string, Array<{ from: string; line: number }>>();
  const outDegreeMap = new Map<string, Array<{ to: string; line: number }>>();
  const externalPkgsMap = new Map<string, Set<string>>();

  for (const f of candidateFiles) {
    inDegreeMap.set(f.path, []);
    outDegreeMap.set(f.path, []);
    externalPkgsMap.set(f.path, new Set());
  }

  for (const e of edges) {
    if (e.status === 'external' && e.from && externalPkgsMap.has(e.from)) {
      externalPkgsMap.get(e.from)!.add(e.specifier);
    }
    if (e.status === 'resolved' && e.to && fileMap.has(e.from) && fileMap.has(e.to)) {
      outDegreeMap.get(e.from)!.push({ to: e.to, line: e.line });
      inDegreeMap.get(e.to)!.push({ from: e.from, line: e.line });
    }
  }

  // 3. Detect Entry Points dynamically from graph topology
  // An entry point has 0 (or lowest) incoming local dependencies, and initiates outgoing calls
  const entryCandidates = candidateFiles.filter((f) => {
    const inCount = inDegreeMap.get(f.path)?.length || 0;
    const outCount = outDegreeMap.get(f.path)?.length || 0;
    return inCount === 0 && outCount > 0;
  });

  // If no strict 0 in-degree file exists (or in disconnected graphs), pick files with lowest in-to-out ratio
  let entryPoints = entryCandidates;
  if (entryPoints.length === 0 && candidateFiles.length > 0) {
    entryPoints = [...candidateFiles]
      .sort((a, b) => {
        const inA = inDegreeMap.get(a.path)?.length || 0;
        const outA = outDegreeMap.get(a.path)?.length || 0;
        const inB = inDegreeMap.get(b.path)?.length || 0;
        const outB = outDegreeMap.get(b.path)?.length || 0;
        return inA - inB || outB - outA || b.lines - a.lines;
      })
      .slice(0, Math.min(3, candidateFiles.length));
  } else {
    // Sort entry points by out-degree descending
    entryPoints.sort((a, b) => {
      const outA = outDegreeMap.get(a.path)?.length || 0;
      const outB = outDegreeMap.get(b.path)?.length || 0;
      return outB - outA || b.lines - a.lines;
    });
  }

  const entrySet = new Set(entryPoints.map((e) => e.path));

  // 4. Calculate BFS Distance from Entry Points to establish execution levels
  const distanceMap = new Map<string, number>();
  const queue: string[] = [];
  for (const ep of entryPoints) {
    distanceMap.set(ep.path, 0);
    queue.push(ep.path);
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currDist = distanceMap.get(curr)!;
    const targets = outDegreeMap.get(curr) || [];
    for (const t of targets) {
      if (!distanceMap.has(t.to)) {
        distanceMap.set(t.to, currDist + 1);
        queue.push(t.to);
      }
    }
  }

  // For any unreached files (disconnected components), calculate their in-degree and size
  for (const f of candidateFiles) {
    if (!distanceMap.has(f.path)) {
      const inCount = inDegreeMap.get(f.path)?.length || 0;
      distanceMap.set(f.path, inCount === 0 ? 0 : 2);
    }
  }

  // 5. Partition files into 5 explainable Learning Stages
  const stage1Files: FileNode[] = []; // Entry Points & System Initialization
  const stage2Files: FileNode[] = []; // Core Data Models & Shared Types
  const stage3Files: FileNode[] = []; // Business Logic & Core Domain Services
  const stage4Files: FileNode[] = []; // Orchestration, Routing & Handlers
  const stage5Files: FileNode[] = []; // Supporting Modules & Utilities

  const assigned = new Set<string>();

  // Stage 1: Put entry points first
  for (const ep of entryPoints) {
    stage1Files.push(ep);
    assigned.add(ep.path);
  }

  // Stage 2: Core Data Models & Shared Types (high in-degree, low out-degree, defining entities)
  for (const f of candidateFiles) {
    if (assigned.has(f.path)) continue;
    const inCount = inDegreeMap.get(f.path)?.length || 0;
    const outCount = outDegreeMap.get(f.path)?.length || 0;
    if (inCount >= 2 && outCount <= 2) {
      stage2Files.push(f);
      assigned.add(f.path);
    }
  }

  // Stage 4: Orchestration & Controllers (directly connected from Entry points, distance === 1)
  for (const f of candidateFiles) {
    if (assigned.has(f.path)) continue;
    const dist = distanceMap.get(f.path);
    const inCallers = inDegreeMap.get(f.path) || [];
    const fromEntry = inCallers.some((c) => entrySet.has(c.from));
    if (fromEntry || dist === 1) {
      stage4Files.push(f);
      assigned.add(f.path);
    }
  }

  // Stage 3: Core Domain Services & Business Logic (intermediate in-degree & out-degree, distance === 2 or 3)
  for (const f of candidateFiles) {
    if (assigned.has(f.path)) continue;
    const inCount = inDegreeMap.get(f.path)?.length || 0;
    const outCount = outDegreeMap.get(f.path)?.length || 0;
    if (inCount >= 1 && outCount >= 1) {
      stage3Files.push(f);
      assigned.add(f.path);
    }
  }

  // Stage 5: Remaining files (utilities, leaves, helpers)
  for (const f of candidateFiles) {
    if (assigned.has(f.path)) continue;
    stage5Files.push(f);
    assigned.add(f.path);
  }

  // Helper to construct DynamicLearningFile
  const mapToFile = (
    f: FileNode,
    stageId: number,
    stageName: string,
    rank: number,
    stageRationale: string
  ): DynamicLearningFile => {
    const inList = inDegreeMap.get(f.path) || [];
    const outList = outDegreeMap.get(f.path) || [];
    const extPkgs = Array.from(externalPkgsMap.get(f.path) || []);
    const inCycle = cycleSet.has(f.path);

    const prerequisites = outList.map((dep) => ({
      path: dep.to,
      name: dep.to.split('/').pop() || dep.to,
      line: dep.line,
      reason: `Directly imported by this module (line ${dep.line})`,
    }));

    const dependents = inList.map((dep) => ({
      path: dep.from,
      name: dep.from.split('/').pop() || dep.from,
      line: dep.line,
    }));

    // Determine importance
    let importance: DynamicLearningFile['importance'] = 'Medium';
    if (stageId === 1 || inList.length >= 5) importance = 'Critical';
    else if (stageId === 2 || inList.length >= 2 || f.lines > 200) importance = 'High';
    else if (stageId === 5 && inList.length === 0) importance = 'Supporting';

    return {
      path: f.path,
      name: f.name,
      ext: f.ext,
      folder: f.folder,
      lines: f.lines,
      size: f.size,
      language: getFileLanguage(f.ext),
      stageId,
      stageName,
      rank,
      importance,
      rationale: stageRationale,
      fanIn: inList.length,
      fanOut: outList.length,
      prerequisites,
      dependents,
      externalPackages: extPkgs,
      functions: f.functions || [],
      exports: f.exports || [],
      complexity: f.complexity,
      inCycle,
    };
  };

  // Build the 5 Stages with ranked files
  const stages: LearningStage[] = [
    {
      id: 1,
      name: 'System Entry Points & Roots',
      description: 'Files that initiate execution, bootstrap configuration, or serve as root dependency drivers.',
      color: '#38BDF8',
      files: stage1Files.map((f, idx) =>
        mapToFile(
          f,
          1,
          'System Entry Points & Roots',
          idx + 1,
          `Identified as an execution entry point with ${inDegreeMap.get(f.path)?.length || 0} incoming and ${outDegreeMap.get(f.path)?.length || 0} outgoing dependencies.`
        )
      ),
    },
    {
      id: 2,
      name: 'Core Data Models & Entities',
      description: 'Foundational structures and definitions consumed across multiple layers of the application.',
      color: '#A78BFA',
      files: stage2Files
        .sort((a, b) => (inDegreeMap.get(b.path)?.length || 0) - (inDegreeMap.get(a.path)?.length || 0))
        .map((f, idx) =>
          mapToFile(
            f,
            2,
            'Core Data Models & Entities',
            idx + 1,
            `Foundational data structure imported by ${inDegreeMap.get(f.path)?.length || 0} other modules.`
          )
        ),
    },
    {
      id: 3,
      name: 'Business Logic & Domain Services',
      description: 'Core functional logic that processes business rules and links data models with workflows.',
      color: '#34D399',
      files: stage3Files
        .sort((a, b) => (inDegreeMap.get(b.path)?.length || 0) - (inDegreeMap.get(a.path)?.length || 0) || b.lines - a.lines)
        .map((f, idx) =>
          mapToFile(
            f,
            3,
            'Business Logic & Domain Services',
            idx + 1,
            `Core processing module connected to ${inDegreeMap.get(f.path)?.length || 0} callers and ${(outDegreeMap.get(f.path)?.length || 0)} dependencies.`
          )
        ),
    },
    {
      id: 4,
      name: 'Orchestration & Controllers',
      description: 'High-level coordinating modules and handlers that dispatch actions and manage data flow.',
      color: '#FBBF24',
      files: stage4Files
        .sort((a, b) => (outDegreeMap.get(b.path)?.length || 0) - (outDegreeMap.get(a.path)?.length || 0))
        .map((f, idx) =>
          mapToFile(
            f,
            4,
            'Orchestration & Controllers',
            idx + 1,
            `Orchestration module dispatching logic to ${outDegreeMap.get(f.path)?.length || 0} subsystems.`
          )
        ),
    },
    {
      id: 5,
      name: 'Supporting Modules & Utilities',
      description: 'Auxiliary helpers, shared formatting utilities, and modular components.',
      color: '#94A3B8',
      files: stage5Files
        .sort((a, b) => b.lines - a.lines)
        .map((f, idx) =>
          mapToFile(
            f,
            5,
            'Supporting Modules & Utilities',
            idx + 1,
            `Supporting module providing specialized utilities and helper routines.`
          )
        ),
    },
  ];

  const totalFilesCount = stages.reduce((acc, st) => acc + st.files.length, 0);
  const detectedLanguages = Array.from(new Set(candidateFiles.map((f) => getFileLanguage(f.ext)))).filter(Boolean);

  return {
    repositoryName: atlas.repo?.name || 'Repository',
    totalAnalyzedFiles: allFiles.length,
    learningFilesCount: totalFilesCount,
    stages,
    entryPointsCount: entryPoints.length,
    languages: detectedLanguages,
    metrics: {
      totalDependencies: edges.length,
      cyclicFilesCount: cycleSet.size,
    },
  };
}

/**
 * Deterministically constructs a rich 7-section explanation from AST & Graph facts.
 * Guaranteed fast, factual, and 100% grounded in code evidence.
 */
export function generateDeterministicFileExplanation(
  file: FileNode,
  atlas: AtlasData,
  analysis?: any,
  sourceCode?: string
): FileExplanation {
  const edges = atlas.edges || [];
  const inEdges = edges.filter((e) => e.status === 'resolved' && e.to === file.path);
  const outEdges = edges.filter((e) => e.from === file.path);
  const internalOut = outEdges.filter((e) => e.status === 'resolved' && e.to);
  const externalOut = outEdges.filter((e) => e.status === 'external');
  const isCyclic = (atlas.cycles || []).some((c) => c.includes(file.path));

  const extPkgs = Array.from(new Set(externalOut.map((e) => e.specifier)));
  const declaredFns = file.functions || [];
  const exportedSymbols = file.exports || [];

  // Determine primary purpose & tier
  let tier = 'Business Logic Module';
  if (inEdges.length === 0 && internalOut.length > 0) tier = 'System Entry Point';
  else if (inEdges.length >= 2 && internalOut.length <= 1) tier = 'Data Model / Type Schema';
  else if (inEdges.length === 0 && internalOut.length === 0) tier = 'Standalone Module / Script';
  else if (inEdges.length >= 4) tier = 'Shared Core Infrastructure';

  const purpose =
    declaredFns.length > 0
      ? `This file encapsulates ${declaredFns.length} primary function(s)/class(es) (${declaredFns
          .slice(0, 3)
          .map((f) => f.name)
          .join(', ')}${declaredFns.length > 3 ? '…' : ''}) and exports ${exportedSymbols.length} symbol(s).`
      : `This file defines module declarations and configuration across ${file.lines} lines of code.`;

  const whyExists = `It serves as a ${tier.toLowerCase()} within the application, managing ${
    internalOut.length > 0 ? `dependencies with ${internalOut.length} internal module(s)` : 'self-contained routines'
  }${inEdges.length > 0 ? ` and providing functionality to ${inEdges.length} other file(s)` : ''}.`;

  // Code Walkthrough
  const codeWalkthrough: FileExplanation['codeWalkthrough'] = [];

  if (exportedSymbols.length > 0) {
    codeWalkthrough.push({
      sectionTitle: 'Public API & Exported Symbols',
      startLine: declaredFns[0]?.line || 1,
      description: `Exposes public functionality to the rest of the application: ${exportedSymbols.slice(0, 5).join(', ')}${
        exportedSymbols.length > 5 ? '…' : ''
      }.`,
      keyItems: exportedSymbols.slice(0, 8),
    });
  }

  if (declaredFns.length > 0) {
    codeWalkthrough.push({
      sectionTitle: 'Declared Functions & Procedures',
      startLine: declaredFns[0].line,
      endLine: declaredFns[declaredFns.length - 1].line,
      description: `Defines primary operations and executable blocks:`,
      keyItems: declaredFns.map((fn) => `${fn.name} (line ${fn.line}) [${fn.kind}]`),
    });
  }

  if (codeWalkthrough.length === 0) {
    codeWalkthrough.push({
      sectionTitle: 'Module Declarations',
      startLine: 1,
      endLine: file.lines,
      description: `Contains module statements and definitions across ${file.lines} lines.`,
      keyItems: [`File scale: ${file.lines} lines`, `Complexity score: ${file.complexity ?? 'N/A'}`],
    });
  }

  // Execution Flow
  const incomingCallers = inEdges.map((e) => ({
    callerPath: e.from,
    line: e.line,
    description: `Imported by ${e.from.split('/').pop() || e.from}`,
    status: 'confirmed_import' as const,
  }));

  const outgoingCalls = internalOut.map((e) => ({
    targetPath: e.to!,
    line: e.line,
    description: `Invokes module ${e.to!.split('/').pop() || e.to}`,
    status: 'confirmed_import' as const,
  }));

  const lifecycleSummary =
    inEdges.length === 0
      ? 'This file is a root initiator: execution starts here without requiring invocations from other local files.'
      : `Execution reaches this file when called by ${inEdges.length} importing module(s). It in turn delegates execution to ${internalOut.length} dependent module(s).`;

  // Key Concepts
  const keyConcepts: FileExplanation['keyConcepts'] = [];
  if (declaredFns.some((f) => f.kind === 'class')) {
    keyConcepts.push({
      concept: 'Object-Oriented Encapsulation',
      explanation: 'Uses classes to bundle state and behavior into reusable structures.',
      contextInCode: `Detected class definitions such as ${declaredFns.find((f) => f.kind === 'class')?.name}.`,
    });
  }
  if (exportedSymbols.length > 0) {
    keyConcepts.push({
      concept: 'Modular Export Contract',
      explanation: 'Exposes defined interfaces and symbols for consumption across boundaries.',
      contextInCode: `Exports ${exportedSymbols.length} symbol(s) including: ${exportedSymbols.slice(0, 3).join(', ')}.`,
    });
  }
  if (internalOut.length > 2) {
    keyConcepts.push({
      concept: 'Modular Dependency Composition',
      explanation: 'Assembles specialized functionality from separate modules rather than monolithic routines.',
      contextInCode: `Imports and coordinates ${internalOut.length} local modules.`,
    });
  }

  // Default concept if none matched
  if (keyConcepts.length === 0) {
    keyConcepts.push({
      concept: 'Source Structure & Organization',
      explanation: 'Organizes executable declarations in a clear, self-contained unit.',
      contextInCode: `${file.lines} lines written in ${getFileLanguage(file.ext)}.`,
    });
  }

  // Learning Check (2-3 realistic questions generated from code facts)
  const learningCheck: FileExplanation['learningCheck'] = [];

  if (declaredFns.length > 0) {
    const mainFn = declaredFns[0].name;
    learningCheck.push({
      id: `q-fn-${file.name}`,
      question: `What primary function or method is declared in ${file.name}?`,
      options: [mainFn, `unrelated_${mainFn}`, `temp_process`, `executeInit`],
      correctIndex: 0,
      explanation: `${mainFn} is declared on line ${declaredFns[0].line} in ${file.name}.`,
    });
  }

  learningCheck.push({
    id: `q-role-${file.name}`,
    question: `What is the architectural role of ${file.name}?`,
    options: [
      tier,
      'Generic database migration script',
      'Minified vendor stylesheet',
      'Temporary test stub',
    ],
    correctIndex: 0,
    explanation: `${file.name} is analyzed as a ${tier} based on its connections and declarations.`,
  });

  return {
    filePath: file.path,
    overview: {
      purpose,
      whyExists,
      tier,
      linesOfCode: file.lines,
      primaryLanguage: getFileLanguage(file.ext),
      exportCount: exportedSymbols.length,
      functionCount: declaredFns.length,
    },
    codeWalkthrough,
    executionFlow: {
      incomingCallers,
      outgoingCalls,
      lifecycleSummary,
    },
    dependencies: {
      internal: [
        ...internalOut.map((e) => ({ path: e.to!, relation: 'imports' as const, line: e.line })),
        ...inEdges.map((e) => ({ path: e.from, relation: 'imported_by' as const, line: e.line })),
      ],
      external: extPkgs,
      dependencyHealth: isCyclic ? 'cyclic' : inEdges.length + internalOut.length > 10 ? 'high_coupling' : 'healthy',
    },
    architecturalRole: {
      layer: tier,
      connectivityScore: inEdges.length + internalOut.length,
      systemImpact: `Modifying this file directly impacts ${inEdges.length} importing module(s).`,
    },
    keyConcepts,
    learningCheck,
  };
}

/**
 * Calls the Groq LLM with a strict prompt and JSON schema to produce
 * rich, contextual beginner explanations grounded in the actual source code.
 */
export async function enrichExplanationWithAI(
  file: FileNode,
  sourceCode: string,
  deterministic: FileExplanation,
  groqApiKey: string,
  groqModel?: string
): Promise<FileExplanation> {
  const modelName = groqModel || 'llama-3.3-70b-versatile';
  const prompt = `You are the master software educator of The Astral Cartographer.
Explain the following source code file for a beginner learner who wants to understand what it does, how it works, and how it connects to the rest of the application.

FILE DETAILS:
- Path: "${file.path}"
- Language: ${getFileLanguage(file.ext)}
- Lines: ${file.lines}
- Declared Functions: ${file.functions.map((f) => f.name).join(', ') || 'None'}
- Exported Symbols: ${file.exports.join(', ') || 'None'}
- Incoming Callers (${deterministic.executionFlow.incomingCallers.length}): ${deterministic.executionFlow.incomingCallers.map((c) => c.callerPath).join(', ') || 'None (Entry point)'}
- Outgoing Dependencies (${deterministic.executionFlow.outgoingCalls.length}): ${deterministic.executionFlow.outgoingCalls.map((c) => c.targetPath).join(', ') || 'None'}

SOURCE CODE EXCERPT (up to 4000 characters):
\`\`\`${file.ext.replace(/^\./, '') || 'text'}
${sourceCode.slice(0, 4000)}
\`\`\`

REQUIREMENTS:
1. Explain based strictly on the source code and details provided above. Do not hallucinate files or behaviors.
2. Return ONLY valid JSON matching this schema:
{
  "purpose": "2-3 sentences explaining what this file does in plain language",
  "whyExists": "Why this file exists and its role in the overall application",
  "codeWalkthrough": [
    {
      "sectionTitle": "Title of section",
      "startLine": 1,
      "endLine": 25,
      "description": "What this section of code does",
      "keyItems": ["bullet 1", "bullet 2"]
    }
  ],
  "lifecycleSummary": "How execution enters this file, what it executes, and where control passes next",
  "keyConcepts": [
    {
      "concept": "Concept name (e.g. Asynchronous Middleware, Factory Pattern, Dependency Injection)",
      "explanation": "Clear beginner-friendly explanation of the concept",
      "contextInCode": "How this concept is specifically used in this file"
    }
  ],
  "learningCheck": [
    {
      "id": "q1",
      "question": "A multiple-choice question testing understanding of this file's code",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why Option A is correct based on the code"
    }
  ]
}`;

  try {
    const { data } = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: modelName,
        messages: [
          {
            role: 'system',
            content: 'You are an expert programming instructor. Output strictly valid JSON without markdown wrapping.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return deterministic;

    const parsed = JSON.parse(raw);

    return {
      ...deterministic,
      overview: {
        ...deterministic.overview,
        purpose: parsed.purpose || deterministic.overview.purpose,
        whyExists: parsed.whyExists || deterministic.overview.whyExists,
      },
      codeWalkthrough:
        Array.isArray(parsed.codeWalkthrough) && parsed.codeWalkthrough.length > 0
          ? parsed.codeWalkthrough
          : deterministic.codeWalkthrough,
      executionFlow: {
        ...deterministic.executionFlow,
        lifecycleSummary: parsed.lifecycleSummary || deterministic.executionFlow.lifecycleSummary,
      },
      keyConcepts:
        Array.isArray(parsed.keyConcepts) && parsed.keyConcepts.length > 0
          ? parsed.keyConcepts
          : deterministic.keyConcepts,
      learningCheck:
        Array.isArray(parsed.learningCheck) && parsed.learningCheck.length > 0
          ? parsed.learningCheck
          : deterministic.learningCheck,
    };
  } catch (err) {
    console.warn('[dynamicLearningService] AI explanation enrichment fallback to deterministic:', err);
    return deterministic;
  }
}
