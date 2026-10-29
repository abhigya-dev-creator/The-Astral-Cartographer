/**
 * Dependency Atlas data model: the single source of truth for server AND client.
 * The client imports this file with `import type`, so it must stay pure types (no imports, no runtime code).
 */

export type FileKind = 'code' | 'asset' | 'other';

export interface FunctionInfo {
  name: string;
  line: number;
  kind: 'function' | 'class' | 'method';
}

export interface FileNode {
  path: string;
  name: string;
  /** lower-case extension including the dot, '' if none */
  ext: string;
  /** directory part of the path, '' for files at the repository root */
  folder: string;
  /** bytes */
  size: number;
  lines: number;
  kind: FileKind;
  functions: FunctionInfo[];
  exports: string[];
  /** 1 + decision points; code files only */
  complexity?: number;
  /** parser tokens (comments excluded); code files only */
  tokens?: number;
  /** set when the file could not be parsed cleanly; the node is still kept */
  parseError?: string;
}

export type EdgeKind = 'import' | 'reexport' | 'require' | 'dynamic';
export type EdgeStatus = 'resolved' | 'external' | 'unresolved';

export interface Edge {
  from: string;
  /** target file path for resolved edges, null otherwise (never guessed) */
  to: string | null;
  specifier: string;
  line: number;
  kind: EdgeKind;
  status: EdgeStatus;
  /** why an edge is external/unresolved, e.g. 'file not found', 'dynamic path', 'built-in module' */
  reason?: string;
}

export interface SkippedEntry {
  path: string;
  reason: 'ignored directory' | 'minified' | 'type declaration' | 'too large' | 'excluded by settings';
}

export interface AtlasRepo {
  owner: string;
  name: string;
  branch: string;
  commitSha: string;
  analyzedAt: string;
  /** 'zip' repositories have no GitHub address, so code preview is unavailable */
  source?: 'github' | 'zip';
}

export interface AtlasStats {
  files: number;
  edges: number;
  unresolved: number;
  parseErrors: number;
  skipped: SkippedEntry[];
}

export interface AtlasData {
  /** schema version, bumped on incompatible changes */
  version: 1;
  repo: AtlasRepo;
  files: FileNode[];
  edges: Edge[];
  /** each cycle is a list of file paths (one strongly connected component, sorted) */
  cycles: string[][];
  stats: AtlasStats;
}
