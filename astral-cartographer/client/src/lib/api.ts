import { supabase } from './supabase';
import { useSettings } from '../context/settingsStore';

/*
 * Types mirror the analysis server contract. Fields introduced by the upgraded
 * analyzer are optional so older stored analyses (and older servers) still render.
 */

export type AnalysisStatus = 'pending' | 'analyzing' | 'completed' | 'failed';
export type AnalysisStage = 'downloading' | 'extracting' | 'analyzing' | 'saving';
export type SupportStatusLevel = 'supported' | 'partial' | 'unsupported';
export type LanguageLevel = 'full' | 'partial' | 'unsupported';
export type IssueConfidence = 'confirmed' | 'heuristic';

export interface IDependencyMetrics {
  externalPackages: number;
  builtInModules: number;
  localDependencies: number;
  dependencyLinks: number;
  unresolvedLocalImports: number;
  rawImportStatements: number;
  assetImports?: number;
  unresolvedAliasImports?: number;
  dynamicNonLiteralImports?: number;
  typeOnlyEdges?: number;
  urlImports?: number;
  aliasResolvedImports?: number;
}

export interface IFunctionKinds {
  declarations: number;
  expressions: number;
  arrows: number;
  methods: number;
  constructors: number;
  objectMethods: number;
}

export interface ILanguageSupport {
  name: string;
  files: number;
  lines: number;
  level: LanguageLevel;
  method: 'ast' | 'heuristic' | 'none';
}

export interface ISupportStatus {
  functionsStatus: SupportStatusLevel;
  dependenciesStatus: SupportStatusLevel;
  supportedLanguages: string[];
  partialLanguages?: string[];
  unsupportedLanguages: string[];
  reason?: string;
  languages?: ILanguageSupport[];
}

export interface ICoverageRule {
  type: string;
  rule: string;
  confidence: IssueConfidence;
  basis?: string;
  eligibleFiles: number;
  incompleteFiles?: number;
  skipped?: Record<string, number>;
  findings: number;
}

export interface ICoverage {
  completeness: 'complete' | 'partial';
  warnings: string[];
  discoveredFiles?: number;
  includedFiles?: number;
  excluded?: Record<string, number>;
  excludedDirectories?: string[];
  /** code files in the repository / those with full or approximate function+dependency data */
  codeFiles?: number;
  analyzedCodeFiles?: number;
  /** included files dropped because the analyzer's file-count limit was reached */
  truncatedFiles?: number;
  timedOut?: boolean;
  parseStatusCounts?: Record<string, number>;
  rules?: ICoverageRule[];
}

export interface IAnalysisMetrics {
  totalFiles: number;
  totalLines?: number;
  /** null = not available for these languages; never treat as 0 */
  functions: number | null;
  /** Dependency graph EDGES (not packages); null = not available */
  dependencies: number | null;
  architecturalIssues: number;
  confirmedIssues?: number;
  heuristicIssues?: number;
  dependencyMetrics?: IDependencyMetrics | null;
  functionKinds?: IFunctionKinds | null;
  supportStatus?: ISupportStatus;
  coverage?: ICoverage;
  /** metricName -> plain-language definition, used for tooltips */
  definitions?: Record<string, string>;
}

export interface IAnalysisLanguage {
  name: string;
  count: number;
  percentage: number;
  lines?: number;
  bytes?: number;
  support?: LanguageLevel | 'n/a';
}

export interface IArchitecturalIssue {
  id?: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  confidence?: IssueConfidence;
  file: string;
  line?: number;
  affectedFiles?: string[];
  description: string;
  rule: string;
}

export type CodeIssueSeverity = 'error' | 'warning' | 'info';
export type CodeIssueConfidence = 'confirmed' | 'heuristic';
export type CodeIssueCategory =
  | 'unused_or_unreachable'
  | 'null_undefined'
  | 'division_by_zero'
  | 'suspicious_loop'
  | 'logical_error'
  | 'resource_management'
  | 'security'
  | 'ai_detected';

export interface CodeIssue {
  id: string;
  ruleId: string;
  ruleName: string;
  category: CodeIssueCategory;
  severity: CodeIssueSeverity;
  confidence: CodeIssueConfidence;
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  explanation: string;
  suggestedFix?: string;
  codeSnippet?: string;
}

export interface CodeInspectionSummary {
  total: number;
  errors: number;
  warnings: number;
  info: number;
  confirmed: number;
  heuristic: number;
  byCategory: Record<CodeIssueCategory, number>;
}

export interface CodeInspectionResult {
  file: string;
  issues: CodeIssue[];
  summary: CodeInspectionSummary;
  durationMs: number;
}

export interface IDependencyEdge {
  source: string;
  target: string;
  type: 'internal' | 'external' | 'builtin';
  kind?: 'static' | 'reexport' | 'dynamic' | 'type';
  line?: number;
}

/** Lightweight analysis as embedded in GET /api/repositories (no files/issues/graph). */
export interface AnalysisSummary {
  _id: string;
  metrics: IAnalysisMetrics;
  languages: IAnalysisLanguage[];
  commitSha?: string | null;
  branch?: string | null;
  version?: string;
  analyzerVersion?: string;
  warnings?: string[];
  truncated?: boolean;
  createdAt?: string;
}

export interface AnalysisDetails extends AnalysisSummary {
  repositoryId: string;
  files: Array<{
    path: string;
    extension: string;
    size: number;
    functionCount: number | null;
    dependencies: string[];
    /** stored by the analyzer; optional for older analyses */
    lineCount?: number;
    language?: string;
    isTest?: boolean;
    parseStatus?: string;
  }>;
  issues: IArchitecturalIssue[];
  codeIssues?: CodeIssue[];
  codeIssuesSummary?: CodeInspectionSummary;
  dependencyGraph: IDependencyEdge[];
}

export interface RepositorySummary {
  _id: string;
  userId: string;
  name: string;
  owner: string;
  fullName: string;
  source: 'github' | 'zip';
  githubUrl?: string;
  description?: string;
  defaultBranch?: string;
  /** May be "Unknown" */
  primaryLanguage: string;
  fileCount: number;
  analysisStatus: AnalysisStatus;
  statusMessage?: string;
  /** current pipeline stage while analyzing; empty when idle */
  analysisStage?: AnalysisStage | '';
  /** GitHub: commit SHA. ZIP: SHA-256 content hash of the archive. */
  commitSha?: string | null;
  lastAnalyzedAt?: string | null;
  createdAt: string;
  latestAnalysis?: AnalysisSummary | null;
}

export interface RepositoryDetails {
  repository: RepositorySummary;
  latestAnalysis: AnalysisDetails | null;
  /** Newest runs first, including failed ones */
  analysisHistory: AnalysisHistoryEntry[];
}

/** One past analysis run as returned in RepositoryDetails.analysisHistory (a light projection). */
export interface AnalysisHistoryEntry {
  _id?: string;
  status?: AnalysisStatus;
  errorMessage?: string;
  commitSha?: string | null;
  branch?: string | null;
  analyzerVersion?: string;
  createdAt?: string;
  metrics?: {
    totalFiles?: number;
    totalLines?: number;
    functions?: number | null;
    dependencies?: number | null;
    architecturalIssues?: number;
    coverage?: { analyzedCodeFiles?: number };
  };
  /** severity and type of each finding (newer servers only) */
  issues?: Array<Pick<IArchitecturalIssue, 'type' | 'severity'>>;
}

/** GET /api/system/info */
export interface SystemInfo {
  analyzerVersion: string;
  database: 'persistent' | 'in-memory' | 'disconnected';
  githubTokenConfigured: boolean;
  limits: {
    maxFiles: number;
    maxParseBytes: number;
    analysisTimeBudgetMs: number;
    maxMapFileBytes: number;
    maxGithubArchiveBytes: number;
    maxZipUploadBytes: number;
    maxArchiveEntries: number;
    maxExcludePatterns: number;
  };
  alwaysSkippedFolders: string[];
  languages: Array<{ name: string; extensions: string[]; functions: string; dependencies: string }>;
}

/** GET /api/system/github */
export interface GitHubRateLimit {
  authenticated: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface RepositoryStatus {
  status: AnalysisStatus;
  stage?: AnalysisStage | null;
  message?: string;
  fileCount?: number;
  commitSha?: string | null;
  lastAnalyzedAt?: string | null;
}

export interface AnalyzeResult {
  success: boolean;
  repository: RepositorySummary;
  analysis: AnalysisDetails;
  /** true = same commit/archive was already analyzed; the stored result was returned */
  reused: boolean;
}

/** Error carrying the HTTP status so the UI can react to 409/429/413/503. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const STATUS_FALLBACKS: Record<number, string> = {
  404: 'Repository not found.',
  409: 'This repository is already being analyzed.',
  413: 'The upload is larger than the 50 MB limit.',
  429: 'Too many requests. Please wait a moment and try again.',
  503: 'The analysis service is temporarily unavailable. Please try again shortly.',
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new ApiError('You must be signed in to access repository services.', 401);
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(path: string, init: RequestInit, fallbackError: string): Promise<T> {
  const headers = await getAuthHeaders();
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError('Could not reach the analysis server. Check your connection and that the server is running.', 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body?.error === 'string' && body.error
      ? body.error
      : STATUS_FALLBACKS[res.status] || `${fallbackError} (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return res.json();
}

function normalizeAnalyzeResult(data: any): AnalyzeResult {
  return {
    success: data?.success !== false,
    repository: data.repository,
    analysis: data.analysis,
    reused: Boolean(data?.reused),
  };
}

export const api = {
  /**
   * Fetch all user repositories with their lightweight latest analysis (metrics + languages)
   */
  async getRepositories(): Promise<RepositorySummary[]> {
    const data = await request<{ repositories?: RepositorySummary[] }>('/api/repositories', {}, 'Failed to fetch repositories');
    return data.repositories || [];
  },

  /**
   * Search user repositories by name or language
   */
  async searchRepositories(query: string): Promise<RepositorySummary[]> {
    const data = await request<{ repositories?: RepositorySummary[] }>(
      `/api/repositories/search?q=${encodeURIComponent(query)}`,
      {},
      'Search failed'
    );
    return data.repositories || [];
  },

  /**
   * Fetch a single repository, its full latest analysis and analysis history
   */
  async getRepositoryDetails(id: string): Promise<RepositoryDetails> {
    const data = await request<any>(`/api/repositories/${encodeURIComponent(id)}`, {}, 'Failed to fetch repository');
    return {
      repository: data.repository,
      latestAnalysis: data.latestAnalysis ?? null,
      analysisHistory: Array.isArray(data.analysisHistory) ? data.analysisHistory : [],
    };
  },

  /**
   * Poll the live status/stage of a repository analysis
   */
  async getRepositoryStatus(id: string): Promise<RepositoryStatus> {
    return request<RepositoryStatus>(`/api/repositories/${encodeURIComponent(id)}/status`, {}, 'Failed to check status');
  },

  /**
   * Submit a public GitHub repository URL for import and analysis.
   * force=true re-runs the analysis even if this commit was analyzed before.
   */
  async analyzeGitHub(url: string, force = false): Promise<AnalyzeResult> {
    const exclude = useSettings.getState().excludedPatterns;
    const data = await request<any>(
      '/api/repositories/analyze-github',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, ...(force ? { force: true } : {}), ...(exclude.length ? { exclude } : {}) }),
      },
      'Analysis failed'
    );
    return normalizeAnalyzeResult(data);
  },

  /**
   * Upload and analyze a local .zip repository file
   */
  async analyzeZip(file: File, projectName?: string, force = false): Promise<AnalyzeResult> {
    const formData = new FormData();
    formData.append('file', file);
    if (projectName) {
      formData.append('projectName', projectName);
    }
    if (force) {
      formData.append('force', 'true');
    }
    const exclude = useSettings.getState().excludedPatterns;
    if (exclude.length) {
      formData.append('exclude', JSON.stringify(exclude));
    }

    // Note: browser automatically sets the multipart/form-data boundary
    const data = await request<any>('/api/repositories/analyze-zip', { method: 'POST', body: formData }, 'ZIP analysis failed');
    return normalizeAnalyzeResult(data);
  },

  /**
   * Delete a repository with all its analyses, stored maps and saved Pathfinder progress.
   */
  async deleteRepository(id: string): Promise<void> {
    await request<unknown>(`/api/repositories/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Failed to delete repository');
  },

  /**
   * The server's real analysis limits, always-skipped folders and language support
   */
  async getSystemInfo(): Promise<SystemInfo> {
    return request<SystemInfo>('/api/system/info', {}, 'Failed to load server information');
  },

  /**
   * GitHub's current rate limit for the credentials the server uses when importing
   */
  async getGitHubRateLimit(): Promise<GitHubRateLimit> {
    return request<GitHubRateLimit>('/api/system/github', {}, 'Failed to check the GitHub rate limit');
  },

  /**
   * Ask the AI companion (Groq on the server). Throws ApiError 503 when the server has no AI key.
   */
  async askAssistant(id: string, body: { question: string; path?: string | null; context?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }): Promise<{ answer: string; model?: string; usedFiles: string[] }> {
    return request(`/api/repositories/${encodeURIComponent(id)}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'The AI assistant could not answer');
  },

  /**
   * Run intelligent bug detection on raw source code snippet
   */
  async inspectSnippet(code: string, path = 'snippet.ts'): Promise<CodeInspectionResult> {
    const res = await request<{ ok: boolean; result: CodeInspectionResult }>(
      '/api/repositories/inspect-snippet',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, path }),
      },
      'Inspection failed'
    );
    return res.result;
  },

  /**
   * Run intelligent bug detection on a specific repository file
   */
  async inspectFile(repoId: string, path: string, code?: string): Promise<CodeInspectionResult> {
    const res = await request<{ ok: boolean; result: CodeInspectionResult }>(
      `/api/repositories/${encodeURIComponent(repoId)}/inspect-file`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...(code ? { code } : {}) }),
      },
      'File inspection failed'
    );
    return res.result;
  },

  /**
   * Fetch dynamically generated repository-aware learning roadmap
   */
  async getLearningRoadmap(repoId: string): Promise<{ success: boolean; commitSha: string; roadmap: DynamicRoadmapResult }> {
    return request(
      `/api/repositories/${encodeURIComponent(repoId)}/learning-roadmap`,
      {},
      'Failed to load learning roadmap'
    );
  },

  /**
   * Fetch 7-section structured explanation for a specific file
   */
  async getFileExplanation(repoId: string, filePath: string, forceAi = false): Promise<{ success: boolean; source: string; explanation: FileExplanation }> {
    return request(
      `/api/repositories/${encodeURIComponent(repoId)}/file-explanation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, forceAi }),
      },
      'Failed to generate file explanation'
    );
  },
};

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
