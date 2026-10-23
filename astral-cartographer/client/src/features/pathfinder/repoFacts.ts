import { buildModel, type AtlasData, type AtlasModel, type Edge, type FileNode } from '../atlas/model';
import { packageOf } from '../atlas/externals';

/**
 * Facts about a repository derived only from its Dependency Atlas (files, resolved imports, symbols).
 * Everything the Onboarding Pathfinder says about structure is built on these, so nothing is guessed from file contents.
 */

const TEST_RE = /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests?\.java$|(^|\/)src\/test\//i;

export function isTestPath(path: string): boolean {
  return TEST_RE.test(path);
}

export const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.tsx': 'TypeScript (JSX)', '.js': 'JavaScript', '.mjs': 'JavaScript',
  '.cjs': 'JavaScript', '.jsx': 'JavaScript (JSX)', '.java': 'Java', '.py': 'Python', '.go': 'Go', '.json': 'JSON', '.md': 'Markdown',
  '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML', '.yml': 'YAML', '.yaml': 'YAML', '.xml': 'XML', '.toml': 'TOML', '.properties': 'Properties',
  '.kt': 'Kotlin', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.sql': 'SQL', '.sh': 'Shell',
};

export function languageOfFile(f: FileNode): string {
  return LANGUAGE_BY_EXT[f.ext] ?? (f.ext ? f.ext.slice(1).toUpperCase() : 'Plain text');
}

export interface Link { path: string; line: number }

export interface RepoFacts {
  model: AtlasModel;
  data: AtlasData;
  /** path of the folder the map treats as the repository root ('' when files sit at the real root) */
  rootPath: string;
  isTest: (path: string) => boolean;
  testFiles: FileNode[];
  /** distinct local files this file imports (resolved edges), first line each */
  imports: (path: string) => Link[];
  /** distinct files that import this file, first line each (tests included) */
  importedBy: (path: string) => Link[];
  /** importers that are not tests */
  fanIn: (path: string) => number;
  /** distinct external packages this file imports */
  packages: (path: string) => string[];
  /** first-level folder below the repository root ("client", "server"), or "(root)" */
  areaOf: (path: string) => string;
  /** files imported directly by at least one test file */
  testedDirectly: Set<string>;
  codeFiles: FileNode[];
  file: (path: string) => FileNode | undefined;
  name: (path: string) => string;
}

function distinctLinks(edges: Edge[] | undefined, pick: (e: Edge) => string | null): Link[] {
  const seen = new Map<string, number>();
  for (const e of edges ?? []) {
    const p = pick(e);
    if (p && !seen.has(p)) seen.set(p, e.line);
  }
  return [...seen].map(([path, line]) => ({ path, line }));
}

export function buildRepoFacts(data: AtlasData, model: AtlasModel = buildModel(data)): RepoFacts {
  const rootPath = model.root.path;
  const testFiles = data.files.filter((f) => isTestPath(f.path));
  const testSet = new Set(testFiles.map((f) => f.path));
  const memo = <T,>(fn: (p: string) => T) => { const m = new Map<string, T>(); return (p: string) => (m.has(p) ? m.get(p)! : (m.set(p, fn(p)), m.get(p)!)); };

  const imports = memo((p) => distinctLinks(model.outgoing.get(p)?.filter((e) => e.status === 'resolved' && e.to && e.to !== p), (e) => e.to));
  const importedBy = memo((p) => distinctLinks(model.incoming.get(p)?.filter((e) => e.from !== p), (e) => e.from));
  const fanIn = memo((p) => importedBy(p).filter((l) => !testSet.has(l.path)).length);
  const packages = memo((p) => [...new Set((model.outgoing.get(p) ?? []).map(packageOf).filter((x): x is string => !!x))].sort());
  const areaOf = (p: string) => {
    const rel = rootPath && p.startsWith(`${rootPath}/`) ? p.slice(rootPath.length + 1) : p;
    const i = rel.indexOf('/');
    return i < 0 ? '(root)' : rel.slice(0, i);
  };
  const testedDirectly = new Set<string>();
  for (const t of testFiles) for (const l of imports(t.path)) testedDirectly.add(l.path);

  return {
    model, data, rootPath,
    isTest: (p) => testSet.has(p),
    testFiles, imports, importedBy, fanIn, packages, areaOf, testedDirectly,
    codeFiles: data.files.filter((f) => f.kind === 'code'),
    file: (p) => model.fileByPath.get(p),
    name: (p) => p.slice(p.lastIndexOf('/') + 1),
  };
}

/** "a, b and 3 more" */
export function listNames(names: string[], max = 3): string {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
