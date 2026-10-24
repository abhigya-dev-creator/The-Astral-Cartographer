import type { FunctionInfo } from '../atlas/model';
import type { IArchitecturalIssue } from '../../lib/api';

export type ExportInfo = string | { name: string; line?: number; kind?: string };

export interface ExplorerTab {
  id: string; // usually file path
  path: string;
  name: string;
  ext: string;
  line?: number;
  nonce?: number;
}

export type ExplorerFileKind = 'code' | 'other' | 'asset';

export interface ExplorerFileItem {
  path: string;
  name: string;
  ext: string;
  folder: string;
  size: number;
  lines: number;
  kind: ExplorerFileKind;
  language: string;
  functions: FunctionInfo[];
  exports: ExportInfo[];
  complexity?: number;
  tokens?: number;
  parseError?: string;
  outgoingDeps: ExplorerDependency[];
  incomingDeps: ExplorerDependent[];
  issues: IArchitecturalIssue[];
}

export interface ExplorerDependency {
  specifier: string;
  resolvedPath: string | null;
  isLocal: boolean;
  isExternal: boolean;
  isBuiltin: boolean;
  line?: number;
  kind?: string;
  reason?: string;
  detail?: string;
}

export interface ExplorerDependent {
  path: string;
  name: string;
  folder: string;
  line?: number;
}

export interface ExplorerMetrics {
  lines: number | null;
  functions: number | null;
  interfaces: number | null;
  dependencies: number | null;
}

export interface ExplorerSummaryData {
  title: string;
  description: string;
  badges: string[];
  role: string;
  isHeuristicOnly: boolean;
  disclaimer: string;
}

export type SearchItemKind = 'file' | 'folder' | 'function' | 'class' | 'export';

export interface SearchItem {
  id: string;
  kind: SearchItemKind;
  title: string;
  subtitle: string;
  path: string;
  line?: number;
  badge?: string;
}
