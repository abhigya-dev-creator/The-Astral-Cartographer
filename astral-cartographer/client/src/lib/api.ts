import { supabase } from './supabase';

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
    functionCount: number;
    dependencies: string[];
  }>;
  issues: IArchitecturalIssue[];
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
  analysisHistory: Array<Partial<AnalysisSummary> & { status?: AnalysisStatus; errorMessage?: string }>;
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
    const data = await request<any>(
      '/api/repositories/analyze-github',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { url, force: true } : { url }),
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

    // Note: browser automatically sets the multipart/form-data boundary
    const data = await request<any>('/api/repositories/analyze-zip', { method: 'POST', body: formData }, 'ZIP analysis failed');
    return normalizeAnalyzeResult(data);
  },
};
