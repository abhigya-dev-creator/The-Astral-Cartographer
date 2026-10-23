import type { AtlasData, SkippedEntry } from './model';

/**
 * Repository explorer tree: the real folder hierarchy (no merged "a/b" folders), built from the AtlasData the
 * page already has. Skipped entries (ignored directories, minified files, .d.ts, files over 1 MB) are included
 * so the tree is complete, but they are marked: they have no node in the dependency graph.
 */
export type ExKind = 'folder' | 'file' | 'skipped-file' | 'skipped-dir';

export interface ExNode {
  path: string;
  name: string;
  kind: ExKind;
  children: ExNode[];
  /** analysed files inside (folders) */
  files: number;
  reason?: SkippedEntry['reason'];
}

export interface ExRow {
  node: ExNode;
  depth: number;
}

const byName = (a: ExNode, b: ExNode) => {
  const fa = a.kind === 'folder' || a.kind === 'skipped-dir' ? 0 : 1;
  const fb = b.kind === 'folder' || b.kind === 'skipped-dir' ? 0 : 1;
  return fa - fb || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1);
};

export function buildExplorerTree(data: AtlasData): ExNode {
  const root: ExNode = { path: '', name: data.repo.name || '/', kind: 'folder', children: [], files: 0 };
  const folders = new Map<string, ExNode>([['', root]]);
  const folderFor = (p: string): ExNode => {
    const hit = folders.get(p);
    if (hit) return hit;
    const i = p.lastIndexOf('/');
    const parent = folderFor(i < 0 ? '' : p.slice(0, i));
    const node: ExNode = { path: p, name: p.slice(i + 1), kind: 'folder', children: [], files: 0 };
    parent.children.push(node);
    folders.set(p, node);
    return node;
  };
  for (const f of data.files) {
    const parent = folderFor(f.folder);
    parent.children.push({ path: f.path, name: f.name, kind: 'file', children: [], files: 0 });
    for (let p: string | null = f.folder; p !== null; p = p === '' ? null : p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') folders.get(p)!.files++;
  }
  for (const s of data.stats.skipped) {
    const i = s.path.lastIndexOf('/');
    const parent = folderFor(i < 0 ? '' : s.path.slice(0, i));
    if (parent.children.some((c) => c.path === s.path)) continue;
    parent.children.push({ path: s.path, name: s.path.slice(i + 1), kind: s.reason === 'ignored directory' ? 'skipped-dir' : 'skipped-file', children: [], files: 0, reason: s.reason });
  }
  const sort = (n: ExNode) => { n.children.sort(byName); n.children.forEach(sort); };
  sort(root);
  return root;
}

/** Rows of the open part of the tree (the root itself is not a row). */
export function flattenVisible(root: ExNode, expanded: ReadonlySet<string>): ExRow[] {
  const rows: ExRow[] = [];
  const walk = (n: ExNode, depth: number) => {
    for (const c of n.children) {
      rows.push({ node: c, depth });
      if (c.kind === 'folder' && expanded.has(c.path)) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Name/path search: name prefix first, then name contains, then path contains. */
export function searchExplorer(root: ExNode, query: string, limit = 200): { results: ExNode[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], total: 0 };
  const hits: Array<{ n: ExNode; rank: number }> = [];
  const walk = (n: ExNode) => {
    for (const c of n.children) {
      const name = c.name.toLowerCase();
      const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : c.path.toLowerCase().includes(q) ? 2 : -1;
      if (rank >= 0) hits.push({ n: c, rank });
      walk(c);
    }
  };
  walk(root);
  hits.sort((a, b) => a.rank - b.rank || a.n.path.length - b.n.path.length || (a.n.path < b.n.path ? -1 : 1));
  return { results: hits.slice(0, limit).map((h) => h.n), total: hits.length };
}

/** Folder paths that must be open to show `path` (its ancestors; not the path itself). */
export function explorerAncestors(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [''];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}
