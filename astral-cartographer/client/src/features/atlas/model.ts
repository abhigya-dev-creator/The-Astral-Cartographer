// Single source of truth for the data model lives in the server package; `import type` is erased at build time.
import type { AtlasData, Edge, FileNode } from '../../../../server/src/services/atlas/types';

export type { AtlasData, Edge, FileNode, FunctionInfo, SkippedEntry, AtlasRepo } from '../../../../server/src/services/atlas/types';

export interface FolderNode {
  /** deepest real path of this (possibly merged) folder; '' for the repository root */
  path: string;
  /** display name; merged single-child chains read "a/b" */
  name: string;
  depth: number;
  parent: FolderNode | null;
  folders: FolderNode[];
  files: FileNode[];
  /** files in this folder and all subfolders */
  totalFiles: number;
  /** name of the top-level folder this belongs to (colour key); '' for root files */
  top: string;
}

export interface AtlasModel {
  data: AtlasData;
  root: FolderNode;
  /** every real folder path (including merged intermediate ones) -> its node */
  folderByPath: Map<string, FolderNode>;
  fileByPath: Map<string, FileNode>;
  /** outgoing edges per file (dependencies), from `data.edges` */
  outgoing: Map<string, Edge[]>;
  /** incoming resolved edges per file (dependents), derived from the SAME edge list */
  incoming: Map<string, Edge[]>;
  /** files that are part of a circular dependency -> cycle index */
  cycleOf: Map<string, number>;
  /** resolved edges whose endpoints are in the same cycle */
  cycleEdges: Set<Edge>;
}

/** Runtime check for data loaded from JSON / the network. Throws a readable message. */
export function parseAtlasData(raw: unknown): AtlasData {
  const fail = (msg: string): never => { throw new Error(`Atlas data is invalid: ${msg}.`); };
  if (!raw || typeof raw !== 'object') fail('not an object');

  let d: any = raw;

  // Handle AtlasLoad result envelopes ({ ok: true, data: ... }) or API response wrappers
  if (d.ok === false) {
    fail(d.message || 'Atlas data could not be loaded');
  }
  if (d.ok === true && d.data && typeof d.data === 'object') {
    d = d.data;
  } else if (d.data && typeof d.data === 'object' && ('files' in d.data || 'repo' in d.data || 'version' in d.data)) {
    d = d.data;
  }

  // Safe fallback or default version ('1.0' / 1) if version is undefined, null, or empty
  const rawVersion = d.version !== undefined && d.version !== null && d.version !== '' ? d.version : '1.0';
  if (rawVersion === 1 || rawVersion === '1.0' || rawVersion === '1') {
    d.version = 1;
  } else {
    fail(`unsupported version ${String(d.version)}`);
  }

  // Safe fallback for repo info if missing or provided at top level
  if (!d.repo && (typeof d.name === 'string' || typeof d.repoName === 'string')) {
    d.repo = {
      owner: d.owner || '',
      name: d.name || d.repoName || 'repository',
      branch: d.branch || 'main',
      commitSha: d.commitSha || '',
      analyzedAt: d.analyzedAt || new Date().toISOString(),
    };
  }

  if (!d.repo || typeof d.repo.name !== 'string') fail('missing repository info');
  if (!Array.isArray(d.files) || !Array.isArray(d.edges) || !Array.isArray(d.cycles) || !d.stats) fail('missing files, edges, cycles or stats');
  const paths = new Set<string>();
  for (const f of d.files) {
    if (typeof f?.path !== 'string' || typeof f.folder !== 'string' || !Array.isArray(f.functions)) fail('a file entry is malformed');
    paths.add(f.path);
  }
  for (const e of d.edges) {
    if (typeof e?.from !== 'string' || !paths.has(e.from)) fail(`edge source ${String(e?.from)} is not a file`);
    if (e.status === 'resolved' ? !(typeof e.to === 'string' && paths.has(e.to)) : e.to !== null) fail(`edge ${e.from} -> ${String(e.to)} has an invalid target`);
  }
  return d as AtlasData;
}

export function buildModel(data: AtlasData): AtlasModel {
  // ---- raw folder tree --------------------------------------------------------------------------
  interface Raw { path: string; name: string; folders: Map<string, Raw>; files: FileNode[] }
  const rawRoot: Raw = { path: '', name: data.repo.name || '/', folders: new Map(), files: [] };
  const rawFolder = (p: string): Raw => {
    let cur = rawRoot;
    if (!p) return cur;
    let acc = '';
    for (const seg of p.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = cur.folders.get(seg);
      if (!next) { next = { path: acc, name: seg, folders: new Map(), files: [] }; cur.folders.set(seg, next); }
      cur = next;
    }
    return cur;
  };
  const fileByPath = new Map<string, FileNode>();
  for (const f of data.files) { rawFolder(f.folder).files.push(f); fileByPath.set(f.path, f); }

  // ---- merge single-child chains, compute depth/top/totals ----------------------------------------
  const folderByPath = new Map<string, FolderNode>();
  const byName = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  const convert = (raw: Raw, parent: FolderNode | null, depth: number, top: string): FolderNode => {
    const aliases = [raw.path];
    let name = raw.name;
    let cur = raw;
    // a folder with no files and exactly one subfolder is shown as "a/b" (not for the root)
    while (parent && cur.files.length === 0 && cur.folders.size === 1) {
      cur = [...cur.folders.values()][0];
      name = `${name}/${cur.name}`;
      aliases.push(cur.path);
    }
    const node: FolderNode = { path: cur.path, name, depth, parent, folders: [], files: [...cur.files].sort(byName), totalFiles: 0, top };
    for (const a of aliases) folderByPath.set(a, node);
    node.folders = [...cur.folders.values()]
      .map((child) => convert(child, node, depth + 1, top || child.name))
      .sort(byName);
    node.totalFiles = node.files.length + node.folders.reduce((s, c) => s + c.totalFiles, 0);
    return node;
  };

  // The repository root is shown transparently: if it only holds one folder, that folder becomes the root.
  let start = rawRoot;
  while (start.files.length === 0 && start.folders.size === 1) start = [...start.folders.values()][0];
  const root = convert(start, null, 0, '');
  for (let r = rawRoot; r !== start; r = [...r.folders.values()][0]) folderByPath.set(r.path, root);
  if (start !== rawRoot) root.name = data.repo.name || start.name;

  // ---- edge indexes (dependents are derived, never stored) ------------------------------------------
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const e of data.edges) {
    (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e);
    if (e.status === 'resolved' && e.to) (incoming.get(e.to) ?? incoming.set(e.to, []).get(e.to)!).push(e);
  }

  const cycleOf = new Map<string, number>();
  data.cycles.forEach((c, i) => c.forEach((p) => cycleOf.set(p, i)));
  const cycleEdges = new Set<Edge>();
  for (const e of data.edges) {
    if (e.to && cycleOf.has(e.from) && cycleOf.get(e.from) === cycleOf.get(e.to)) cycleEdges.add(e);
  }

  return { data, root, folderByPath, fileByPath, outgoing, incoming, cycleOf, cycleEdges };
}

/** Folder chain from the root down to (and including) `folder`. */
export function ancestors(folder: FolderNode): FolderNode[] {
  const out: FolderNode[] = [];
  for (let f: FolderNode | null = folder; f; f = f.parent) out.unshift(f);
  return out;
}

export function allFolders(root: FolderNode): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (f: FolderNode) => { out.push(f); f.folders.forEach(walk); };
  walk(root);
  return out;
}

export const LAYOUT_BUDGET = { VISIBLE_ITEMS: 600, MAX_DEPTH: 4 };

/**
 * Folders that start expanded: breadth-first from the top, as long as the number of visible items stays
 * within the budget. Large or deep folders therefore start collapsed. Deterministic.
 */
export function defaultExpanded(root: FolderNode): Set<string> {
  const expanded = new Set<string>([root.path]);
  let visible = root.files.length + root.folders.length;
  const queue = [...root.folders];
  while (queue.length) {
    const f = queue.shift()!;
    const adds = f.files.length + f.folders.length;
    if (f.depth > LAYOUT_BUDGET.MAX_DEPTH || visible + adds > LAYOUT_BUDGET.VISIBLE_ITEMS) continue;
    expanded.add(f.path);
    visible += adds;
    queue.push(...f.folders);
  }
  return expanded;
}
