import { create } from 'zustand';
import type { EdgeKind } from '../../../../server/src/services/atlas/types';
import type { IArchitecturalIssue } from '../../lib/api';
import { ancestors, buildModel, defaultExpanded, type AtlasData, type AtlasModel } from './model';
import { withExternalPackages } from './externals';
import { isolateSet, tracePath, type TraceResult } from './graph';

/**
 * What is selected. `link` = the relationship between two files (all import statements between them);
 * `folderLink` = all relationships between two top-level folders (zoomed-out "Show all" lines).
 */
export type Selection =
  | { type: 'file'; path: string }
  | { type: 'folder'; path: string }
  | { type: 'link'; from: string; to: string }
  | { type: 'folderLink'; from: string; to: string }
  | null;

/** File-type groups used by the type filter. */
export const TYPE_GROUPS = ['TypeScript', 'JavaScript', 'Styles', 'Data', 'Images', 'Other'] as const;
export type TypeGroup = (typeof TYPE_GROUPS)[number];

export function typeGroup(ext: string): TypeGroup {
  if (/^\.(ts|tsx|mts|cts)$/.test(ext)) return 'TypeScript';
  if (/^\.(js|jsx|mjs|cjs)$/.test(ext)) return 'JavaScript';
  if (/^\.(css|scss|sass|less|styl)$/.test(ext)) return 'Styles';
  if (/^\.(json|ya?ml|toml|xml|csv)$/.test(ext)) return 'Data';
  if (/^\.(svg|png|jpe?g|gif|webp|avif|ico|bmp)$/.test(ext)) return 'Images';
  return 'Other';
}

export interface AtlasFilters {
  /** top-level folder names that are hidden (dimmed) */
  hiddenFolders: ReadonlySet<string>;
  hiddenTypes: ReadonlySet<TypeGroup>;
  hiddenKinds: ReadonlySet<EdgeKind>;
  cyclesOnly: boolean;
  /** only files with architectural findings */
  findingsOnly: boolean;
}

export interface FocusRequest {
  type: 'file' | 'folder' | 'fit' | 'set';
  path: string;
  nonce: number;
  /** for 'set': fit these file paths */
  paths?: string[];
}

export interface IsolateState {
  path: string;
  depth: 1 | 2 | 3;
  members: ReadonlySet<string>;
}

interface AtlasState {
  status: 'loading' | 'ready' | 'empty' | 'error';
  error: string | null;
  /** AtlasData as received from the server (never modified) */
  baseData: AtlasData | null;
  model: AtlasModel | null;
  /** analysed repository this data belongs to; null for sample/synthetic data */
  repositoryId: string | null;
  expanded: ReadonlySet<string>;
  selected: Selection;
  showDependencies: boolean;
  showDependents: boolean;
  showAll: boolean;
  /** show external packages as virtual nodes */
  showExternal: boolean;
  search: string;
  filters: AtlasFilters;
  viewMode: '2d' | '3d';
  /** architectural findings per file path (from the same analysis); empty when unavailable */
  findings: ReadonlyMap<string, IArchitecturalIssue[]>;
  findingsNote: string | null;
  isolate: IsolateState | null;
  trace: TraceResult | null;
  /** folders open in the repository explorer (independent of the map) */
  treeExpanded: ReadonlySet<string>;
  /** ask the active view to move its camera */
  focus: FocusRequest | null;
  /** keep this cluster still on screen when the layout changes (the folder the user just toggled) */
  anchor: { key: string; nonce: number } | null;
  /** line the code viewer should scroll to (e.g. the import line of a clicked dependency) */
  codeLine: { path: string; line: number; nonce: number } | null;

  setLoading: () => void;
  setError: (message: string) => void;
  load: (data: AtlasData, repositoryId?: string | null) => void;
  setFindings: (findings: ReadonlyMap<string, IArchitecturalIssue[]>, note: string | null) => void;
  select: (sel: Selection) => void;
  /** select + expand every collapsed parent + move the camera to it */
  reveal: (sel: { type: 'file' | 'folder'; path: string }) => void;
  toggleFolder: (path: string) => void;
  setExpanded: (paths: ReadonlySet<string>) => void;
  setToggle: (key: 'showDependencies' | 'showDependents' | 'showAll', value: boolean) => void;
  setShowExternal: (value: boolean) => void;
  setSearch: (q: string) => void;
  setFilters: (patch: Partial<AtlasFilters>) => void;
  setViewMode: (mode: '2d' | '3d') => void;
  requestFit: () => void;
  focusSelection: () => void;
  setIsolate: (path: string | null, depth?: 1 | 2 | 3) => void;
  setTrace: (from: string | null, to?: string) => void;
  setTreeExpanded: (paths: ReadonlySet<string>) => void;
  scrollCodeTo: (path: string, line: number) => void;
  /** Escape: undo the most recent exploration step. Returns false when there was nothing to undo. */
  escape: () => boolean;
  /** clean initial state: no selection, isolation, trace or dependency lines (filters kept) */
  clear: () => void;
}

const NO_FILTERS: AtlasFilters = { hiddenFolders: new Set(), hiddenTypes: new Set(), hiddenKinds: new Set(), cyclesOnly: false, findingsOnly: false };
let nonce = 0;

/** Parent folders of a path, for opening the explorer tree at a file or folder. */
function treeAncestors(path: string, includeSelf: boolean): string[] {
  const parts = path.split('/');
  const out: string[] = [''];
  for (let i = 1; i < parts.length + (includeSelf ? 1 : 0); i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

export const useAtlasStore = create<AtlasState>((set, get) => ({
  status: 'loading',
  error: null,
  baseData: null,
  model: null,
  repositoryId: null,
  expanded: new Set(),
  selected: null,
  showDependencies: true,
  showDependents: true,
  showAll: false,
  showExternal: false,
  search: '',
  filters: NO_FILTERS,
  viewMode: '2d',
  findings: new Map(),
  findingsNote: null,
  isolate: null,
  trace: null,
  treeExpanded: new Set(['']),
  focus: null,
  anchor: null,
  codeLine: null,

  setLoading: () => set({ status: 'loading', error: null }),
  setError: (message) => set({ status: 'error', error: message, model: null, baseData: null }),
  load: (data, repositoryId = null) => {
    const model = buildModel(get().showExternal ? withExternalPackages(data) : data);
    set({
      baseData: data,
      model,
      repositoryId,
      status: data.files.length ? 'ready' : 'empty',
      error: null,
      expanded: defaultExpanded(model.root),
      selected: null,
      showAll: false,
      filters: NO_FILTERS,
      findings: new Map(),
      findingsNote: null,
      isolate: null,
      trace: null,
      treeExpanded: new Set(['']),
      focus: { type: 'fit', path: '', nonce: ++nonce },
      anchor: null,
      codeLine: null,
    });
  },
  setFindings: (findings, note) => set({ findings, findingsNote: note }),

  select: (sel) => {
    const patch: Partial<AtlasState> = { selected: sel, codeLine: null };
    // the explorer opens at the selected file/folder (graph -> tree synchronisation)
    if (sel && (sel.type === 'file' || sel.type === 'folder')) {
      const next = new Set(get().treeExpanded);
      for (const p of treeAncestors(sel.path, sel.type === 'folder')) next.add(p);
      patch.treeExpanded = next;
    }
    set(patch);
  },
  reveal: (sel) => {
    const { model, expanded } = get();
    if (!model) return;
    const folderPath = sel.type === 'file' ? model.fileByPath.get(sel.path)?.folder : sel.path;
    const folder = folderPath !== undefined ? model.folderByPath.get(folderPath) : undefined;
    const next = new Set(expanded);
    if (folder) for (const f of ancestors(folder)) next.add(f.path);
    set({ expanded: next, focus: { type: sel.type, path: sel.path, nonce: ++nonce } });
    get().select(sel);
  },
  toggleFolder: (path) => {
    const next = new Set(get().expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    set({ expanded: next, anchor: { key: path, nonce: ++nonce } });
  },
  setExpanded: (paths) => set({ expanded: paths }),
  setToggle: (key, value) => set({ [key]: value } as Pick<AtlasState, typeof key>),
  setShowExternal: (value) => {
    const { baseData, selected, expanded } = get();
    if (!baseData) { set({ showExternal: value }); return; }
    const model = buildModel(value ? withExternalPackages(baseData) : baseData);
    // keep the exploration: folders stay open, the selection survives if it still exists
    const keep = selected && selected.type === 'file' ? model.fileByPath.has(selected.path) : true;
    set({ showExternal: value, model, expanded: new Set([...expanded, ...defaultExpanded(model.root)]), selected: keep ? selected : null, isolate: null, trace: null });
  },
  setSearch: (q) => set({ search: q }),
  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
  setViewMode: (mode) => set({ viewMode: mode }),
  requestFit: () => set({ focus: { type: 'fit', path: '', nonce: ++nonce } }),
  focusSelection: () => {
    const { selected, isolate } = get();
    if (isolate) set({ focus: { type: 'set', path: isolate.path, paths: [...isolate.members], nonce: ++nonce } });
    else if (selected?.type === 'file' || selected?.type === 'folder') set({ focus: { type: selected.type, path: selected.path, nonce: ++nonce } });
    else if (selected?.type === 'link') set({ focus: { type: 'set', path: selected.from, paths: [selected.from, selected.to], nonce: ++nonce } });
  },
  setIsolate: (path, depth = 1) => {
    const { model, filters } = get();
    if (!path || !model) { set({ isolate: null }); return; }
    const members = isolateSet(model, path, depth, (e) => !filters.hiddenKinds.has(e.kind));
    // open every folder that holds a member, select the file, then frame the whole neighbourhood
    const next = new Set(get().expanded);
    for (const p of members) {
      const folder = model.folderByPath.get(model.fileByPath.get(p)?.folder ?? '');
      if (folder) for (const f of ancestors(folder)) next.add(f.path);
    }
    set({ isolate: { path, depth, members }, expanded: next });
    get().select({ type: 'file', path });
    set({ focus: { type: 'set', path, paths: [...members], nonce: ++nonce } });
  },
  setTrace: (from, to) => {
    const { model, filters } = get();
    if (!from || !to || !model) { set({ trace: null }); return; }
    const trace = tracePath(model, from, to, (e) => !filters.hiddenKinds.has(e.kind));
    // open every folder on the path so the whole chain is visible, then frame it
    const next = new Set(get().expanded);
    for (const p of trace.path ?? [from, to]) {
      const folder = model.folderByPath.get(model.fileByPath.get(p)?.folder ?? '');
      if (folder) for (const f of ancestors(folder)) next.add(f.path);
    }
    set({ trace, expanded: next, focus: { type: 'set', path: from, paths: trace.path ?? [from, to], nonce: ++nonce } });
  },
  setTreeExpanded: (paths) => set({ treeExpanded: paths }),
  scrollCodeTo: (path, line) => set({ codeLine: { path, line, nonce: ++nonce } }),
  escape: () => {
    const s = get();
    if (s.isolate) { set({ isolate: null }); return true; }
    if (s.trace) { set({ trace: null }); return true; }
    if (s.selected || s.showAll) { set({ selected: null, showAll: false, codeLine: null }); return true; }
    return false;
  },
  clear: () => set({ selected: null, showAll: false, codeLine: null, isolate: null, trace: null }),
}));
