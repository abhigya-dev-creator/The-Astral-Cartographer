import type { AnalysisStage, IAnalysisMetrics } from './api';

export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMins > 0) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  return 'Just now';
}

export function formatDateTime(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/** Formats a real number. Callers must handle null/undefined (N/A) themselves. */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function isAvailable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function shortSha(sha?: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

export function getLanguageColor(lang?: string): string {
  switch (lang?.toLowerCase()) {
    case 'typescript':
      return '#386BFF';
    case 'javascript':
      return '#F7DF1E';
    case 'python':
      return '#3572A5';
    case 'go':
      return '#00ADD8';
    case 'rust':
      return '#DEA584';
    case 'css':
    case 'scss':
      return '#563D7C';
    case 'html':
      return '#E34C26';
    case 'unknown':
    case undefined:
      return '#77839C';
    default:
      return '#8B78FF';
  }
}

/** "minified_or_sourcemap" / "binaryContent" -> "Minified or sourcemap" / "Binary content" */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const ANALYSIS_STAGES: Array<{ id: AnalysisStage; label: string }> = [
  { id: 'downloading', label: 'Downloading' },
  { id: 'extracting', label: 'Extracting' },
  { id: 'analyzing', label: 'Analyzing' },
  { id: 'saving', label: 'Saving' },
];

/** https://github.com/owner/repo with optional .git, trailing slash or /tree/<branch> */
const GITHUB_URL_RE =
  /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^\s?#]+?))?\/?$/;

export function parseGitHubUrl(raw: string): { owner: string; repo: string; branch: string | null } | null {
  const match = raw.trim().match(GITHUB_URL_RE);
  if (!match) return null;
  const [, owner, repo, branch] = match;
  if (repo === '.' || repo === '..') return null;
  return { owner, repo, branch: branch ?? null };
}

/**
 * Mirrors sanitizeProjectName() in server/src/services/repositoryService.ts, used to find the new
 * repository while polling. The server matches names case-insensitively, so compare lowercased.
 */
export function sanitizeProjectName(name: string): string {
  const cleaned = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return cleaned || 'Uploaded Project';
}

/** Label for repository.commitSha: a git commit for GitHub, a content hash for ZIP uploads. */
export function revisionLabel(source: 'github' | 'zip'): string {
  return source === 'zip' ? 'Archive hash' : 'Commit';
}

export const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/** Used only when the server did not send `metrics.definitions`. */
const FALLBACK_DEFINITIONS: Record<string, string> = {
  totalFiles: 'Source files that were included in the analysis after exclusions.',
  totalLines: 'Lines across all included files.',
  functions:
    'Function-like constructs found: declarations, expressions, arrow functions, methods, constructors and object methods.',
  dependencies: 'Edges in the dependency graph (importing file → imported target). This is not a package count.',
  architecturalIssues: 'Findings from the architectural checks, both confirmed and heuristic.',
  confirmedIssues: 'Findings from deterministic checks, e.g. an import cycle that exists in the code.',
  heuristicIssues: 'Findings from threshold-based checks, e.g. a file with unusually many imports. Review before acting.',
  externalPackages: 'Distinct third-party packages imported (e.g. react, lodash), counted once each.',
  builtInModules: 'Distinct runtime built-in modules imported (e.g. fs, path), counted once each.',
  localDependencies: 'Unique files in this repository that are imported by at least one other file.',
  dependencyLinks: 'Edges in the dependency graph: one per importing file → imported target pair.',
  unresolvedLocalImports: 'Relative imports whose target file could not be found in the repository.',
  rawImportStatements: 'Every import / require / export-from statement found, before de-duplication.',
  assetImports: 'Imports of non-code assets such as stylesheets, images or JSON.',
  unresolvedAliasImports: 'Imports using a path alias (e.g. @/…) that could not be resolved to a file.',
  dynamicNonLiteralImports: 'import() / require() calls with a computed path that cannot be followed statically.',
  typeOnlyEdges: 'Graph edges that exist only for TypeScript types (import type).',
  urlImports: 'Imports from a URL (e.g. https://…).',
  aliasResolvedImports: 'Path-alias imports that were resolved to a file in this repository.',
};

export function definitionFor(metrics: IAnalysisMetrics | undefined, key: string): string | undefined {
  return metrics?.definitions?.[key] || FALLBACK_DEFINITIONS[key];
}

export const DEFAULT_NA_REASON = 'Not available for the languages in this repository.';
