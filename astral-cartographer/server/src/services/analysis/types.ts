export type SupportLevelKind = 'full' | 'approx' | 'none';

export type FileParseStatus =
  | 'parsed' // full AST parse, no errors
  | 'recovered' // AST parse with recoverable syntax errors
  | 'fallback' // AST parse failed; approximate regex scan used (flagged)
  | 'approximate' // heuristic analyzer (Python/Go)
  | 'skipped_large' // too large to parse; line count only
  | 'skipped_timeout' // analysis time budget exhausted before this file
  | 'unreadable' // read error
  | 'unsupported' // code in a language without an analyzer
  | 'not_code'; // docs / config / data

export interface AnalyzedFile {
  path: string;
  extension: string;
  language: string;
  size: number;
  lineCount: number;
  /** null = not available (unsupported language, skipped or unreadable file) – never a fake 0 */
  functionCount: number | null;
  /** raw specifiers, one entry per import occurrence, in source order */
  dependencies: string[];
  resolvedLocalDeps: string[];
  unresolvedLocalDeps: string[];
  parseStatus: FileParseStatus;
  warnings: string[];
  isTest: boolean;
  isGenerated: boolean;
  isDeclaration: boolean;
  support: { functions: SupportLevelKind; dependencies: SupportLevelKind };
}

/** static > reexport > dynamic > type. static & reexport are eager (executed at load time). */
export type DependencyEdgeKind = 'static' | 'reexport' | 'dynamic' | 'type';

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'internal' | 'external' | 'builtin';
  kind: DependencyEdgeKind;
  line?: number;
}

export type Confidence = 'confirmed' | 'heuristic';

export interface ArchitecturalIssue {
  id: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  /** confirmed = deterministic structural fact; heuristic = threshold/judgement based */
  confidence: Confidence;
  file: string;
  line?: number;
  affectedFiles: string[];
  description: string;
  rule: string;
}

export interface RuleRun {
  type: string;
  rule: string;
  confidence: Confidence;
  basis: string;
  eligibleFiles: number;
  /** eligible files whose data was incomplete for this rule (e.g. imports not analysed) */
  incompleteFiles: number;
  /** code files the rule could not run on, with reason */
  skipped: Record<string, number>;
  findings: number;
}

export interface IDependencyMetrics {
  externalPackages: number;
  localDependencies: number;
  dependencyLinks: number;
  unresolvedLocalImports: number;
  rawImportStatements: number;
  builtInModules: number;
  /** imports of images/fonts/etc. that exist in the repo but are not analysed source (not counted as unresolved) */
  assetImports: number;
  /** unresolved because they use a bundler alias (`@/x`, `~/x`) the analyzer could not map */
  unresolvedAliasImports: number;
  /** import()/require() calls with a computed argument; cannot be resolved statically */
  dynamicNonLiteralImports: number;
  /** edges that exist only as erased `import type` */
  typeOnlyEdges: number;
  /** URL imports (https://…) – not counted as packages */
  urlImports: number;
  /** imports that resolved via tsconfig paths/baseUrl, workspaces, or package.json#imports */
  aliasResolvedImports: number;
}

export interface LanguageSupportEntry {
  name: string;
  files: number;
  lines: number;
  functions: SupportLevelKind;
  dependencies: SupportLevelKind;
  level: 'full' | 'partial' | 'unsupported';
  method: 'ast' | 'heuristic' | 'none';
}

export interface ISupportStatus {
  functionsSupported: boolean;
  dependenciesSupported: boolean;
  functionsStatus: 'supported' | 'unsupported' | 'partial';
  dependenciesStatus: 'supported' | 'unsupported' | 'partial';
  supportedLanguages: string[];
  /** languages analysed heuristically (Python, Go) – numbers are approximate */
  partialLanguages: string[];
  unsupportedLanguages: string[];
  reason?: string;
  languages: LanguageSupportEntry[];
}

export interface CoverageInfo {
  /** files discovered on disk outside ignored directories */
  discoveredFiles: number;
  includedFiles: number;
  excluded: Record<string, number>;
  excludedDirectories: string[];
  codeFiles: number;
  /** code files with full or approximate function/dependency data */
  analyzedCodeFiles: number;
  parseStatusCounts: Record<string, number>;
  /** included files dropped because MAX_FILES was exceeded (0 = nothing dropped) */
  truncatedFiles: number;
  timedOut: boolean;
  analysisMs: number;
  tsconfigsLoaded: number;
  workspacePackages: number;
  archive?: { entries: number; extractedFiles: number; extractedBytes: number; skippedSymlinks: number; skippedIgnored: number; skippedOversize: number };
  rules: RuleRun[];
  /** human-readable reasons the result may be incomplete */
  warnings: string[];
  completeness: 'complete' | 'partial';
}

export interface AnalysisMetrics {
  totalFiles: number;
  functions: number | null;
  dependencies: number | null;
  architecturalIssues: number;
  dependencyMetrics: IDependencyMetrics | null;
  supportStatus: ISupportStatus;
  functionKinds: Record<string, number> | null;
  totalLines: number;
  confirmedIssues: number;
  heuristicIssues: number;
  coverage: CoverageInfo;
  definitions: Record<string, string>;
}

export interface LanguageBreakdownEntry {
  name: string;
  count: number;
  percentage: number;
  lines: number;
  bytes: number;
  support: 'full' | 'partial' | 'unsupported' | 'n/a';
}

export interface AnalysisResult {
  metrics: AnalysisMetrics;
  languages: LanguageBreakdownEntry[];
  primaryLanguage: string;
  files: AnalyzedFile[];
  issues: ArchitecturalIssue[];
  dependencyGraph: DependencyEdge[];
  analyzerVersion: string;
}
