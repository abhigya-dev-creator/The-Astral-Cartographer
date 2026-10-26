import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizeFindings } from './findingText';
import {
  AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, File, FileCode2, FileCog, FileImage, FileJson, FileText, Folder, FolderOpen, LocateFixed, Search,
} from 'lucide-react';
import { useAtlasStore } from './atlasStore';
import { buildExplorerTree, explorerAncestors, flattenVisible, searchExplorer, type ExNode } from './explorerTree';
import { RELATION_COLORS } from './palette';

const ROW_H = 26;
const OVERSCAN = 12;
const SEVERITY_COLOR = { error: '#FF717A', warning: '#FFD166', info: '#6898FF' } as const;

function FileIcon({ name }: { name: string }) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const style = { flexShrink: 0 } as const;
  if (/^(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(ext)) return <FileCode2 size={14} color="#8EB5FF" style={style} />;
  if (ext === 'json') return <FileJson size={14} color="#FFD166" style={style} />;
  if (/^(svg|png|jpe?g|gif|webp|avif|ico|bmp)$/.test(ext)) return <FileImage size={14} color="#43D9A3" style={style} />;
  if (/^(md|mdx|txt|rst)$/.test(ext)) return <FileText size={14} color="#A7B4CC" style={style} />;
  if (/^(ya?ml|toml|ini|env|lock|config)$/.test(ext) || name.startsWith('.')) return <FileCog size={14} color="#A99AFF" style={style} />;
  return <File size={14} color="#77839C" style={style} />;
}

export default function RepoExplorer() {
  const baseData = useAtlasStore((s) => s.baseData);
  const model = useAtlasStore((s) => s.model);
  const selected = useAtlasStore((s) => s.selected);
  const treeExpanded = useAtlasStore((s) => s.treeExpanded);
  const findings = useAtlasStore((s) => s.findings);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<ExNode | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);
  const listRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => (baseData ? buildExplorerTree(baseData) : null), [baseData]);
  const rows = useMemo(() => (tree ? flattenVisible(tree, treeExpanded) : []), [tree, treeExpanded]);
  const search = useMemo(() => (tree && query.trim() ? searchExplorer(tree, query) : null), [tree, query]);
  const selectedPath = selected?.type === 'file' || selected?.type === 'folder' ? selected.path : null;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [search]);

  // graph -> tree: the store opened the parents on selection; bring the row into view and give it focus position
  useEffect(() => {
    if (!selectedPath || search) return;
    const i = rows.findIndex((r) => r.node.path === selectedPath);
    if (i < 0) return;
    setFocusIndex(i);
    const el = listRef.current;
    if (el && (i * ROW_H < el.scrollTop || (i + 1) * ROW_H > el.scrollTop + el.clientHeight)) {
      el.scrollTop = Math.max(0, i * ROW_H - el.clientHeight / 3);
      setScrollTop(el.scrollTop);
    }
  }, [selectedPath, rows, search]);

  if (!tree || !model) return null;

  const setExpanded = (path: string, open: boolean) => {
    const next = new Set(useAtlasStore.getState().treeExpanded);
    if (open) next.add(path); else next.delete(path);
    useAtlasStore.getState().setTreeExpanded(next);
  };

  /** tree -> graph. Files select + focus their node; folders only open/close in the tree. */
  const activate = (n: ExNode) => {
    setNote(null);
    if (n.kind === 'file') useAtlasStore.getState().reveal({ type: 'file', path: n.path });
    else if (n.kind === 'folder') setExpanded(n.path, !treeExpanded.has(n.path));
    else setNote(note?.path === n.path ? null : n); // skipped: show where it is and why there is no node
  };
  const showFolderOnMap = (n: ExNode) => {
    if (model.folderByPath.has(n.path)) useAtlasStore.getState().reveal({ type: 'folder', path: n.path });
  };
  const openSearchResult = (n: ExNode) => {
    const next = new Set(useAtlasStore.getState().treeExpanded);
    for (const p of explorerAncestors(n.path)) next.add(p);
    if (n.kind === 'folder') next.add(n.path);
    useAtlasStore.getState().setTreeExpanded(next);
    setQuery('');
    if (n.kind === 'file') useAtlasStore.getState().reveal({ type: 'file', path: n.path });
    else if (n.kind !== 'folder') setNote(n);
    requestAnimationFrame(() => {
      const i = flattenVisible(tree, next).findIndex((r) => r.node.path === n.path);
      if (i >= 0) { setFocusIndex(i); listRef.current?.scrollTo({ top: Math.max(0, i * ROW_H - 80) }); }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[focusIndex];
    if (!row) return;
    const move = (i: number) => {
      const j = Math.max(0, Math.min(rows.length - 1, i));
      setFocusIndex(j);
      const el = listRef.current;
      if (el && (j * ROW_H < el.scrollTop || (j + 1) * ROW_H > el.scrollTop + el.clientHeight)) el.scrollTop = j * ROW_H - el.clientHeight / 2;
      requestAnimationFrame(() => (listRef.current?.querySelector(`[data-row="${j}"]`) as HTMLElement | null)?.focus());
    };
    const n = row.node;
    switch (e.key) {
      case 'ArrowDown': move(focusIndex + 1); break;
      case 'ArrowUp': move(focusIndex - 1); break;
      case 'Home': move(0); break;
      case 'End': move(rows.length - 1); break;
      case 'ArrowRight':
        if (n.kind === 'folder' && !treeExpanded.has(n.path)) setExpanded(n.path, true);
        else if (n.kind === 'folder') move(focusIndex + 1);
        break;
      case 'ArrowLeft':
        if (n.kind === 'folder' && treeExpanded.has(n.path)) setExpanded(n.path, false);
        else { const parent = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''; const i = rows.findIndex((r) => r.node.path === parent); if (i >= 0) move(i); }
        break;
      case 'Enter': case ' ': activate(n); break;
      default: return;
    }
    e.preventDefault();
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const badges = (n: ExNode) => (
    <>
      {model.cycleOf.has(n.path) && <span className="atlas-dot" title="Part of a circular dependency" style={{ background: RELATION_COLORS.cycle }} />}
      {(findings.get(n.path)?.length ?? 0) > 0 && (
        <span title={`${summarizeFindings(findings.get(n.path)!)}. Select the file and open its Findings tab to see them explained.`} style={{ display: 'inline-flex' }}>
          <AlertTriangle size={12} color={SEVERITY_COLOR[findings.get(n.path)!.some((i) => i.severity === 'error') ? 'error' : findings.get(n.path)!.some((i) => i.severity === 'warning') ? 'warning' : 'info']} />
        </span>
      )}
    </>
  );
  const skippedLabel = (n: ExNode) => (n.kind === 'skipped-dir' ? 'ignored folder' : n.reason ?? 'not analysed');

  return (
    <div className="atlas-explorer">
      <div className="atlas-search" style={{ width: '100%', marginBottom: 8 }}>
        <Search size={14} />
        <input
          className="atlas-input"
          type="search"
          placeholder="Find a file or folder by name or path…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); } if (e.key === 'Enter' && search?.results[0]) openSearchResult(search.results[0]); }}
          aria-label="Find a file or folder in the repository"
        />
      </div>

      {search ? (
        <div className="atlas-panel-scroll" role="listbox" aria-label="Matching files and folders">
          {search.total === 0 && <p className="atlas-count" style={{ padding: 8 }}>Nothing matches “{query}”.</p>}
          {search.results.map((n) => (
            <button key={n.path} type="button" role="option" aria-selected={selectedPath === n.path} className="atlas-row" onClick={() => openSearchResult(n)} title={n.path}>
              {n.kind === 'folder' || n.kind === 'skipped-dir' ? <Folder size={14} color="#FFD166" style={{ flexShrink: 0 }} /> : <FileIcon name={n.name} />}
              <span className="atlas-grow">
                <span style={{ color: n.kind.startsWith('skipped') ? '#77839C' : '#EAF0FF' }}>{n.name}</span>
                <span className="atlas-sub" style={{ display: 'block', font: '10.5px var(--font-mono)', color: '#77839C', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.path}</span>
              </span>
              {n.kind.startsWith('skipped') && <span className="atlas-count">{skippedLabel(n)}</span>}
              {badges(n)}
            </button>
          ))}
          {search.total > search.results.length && <p className="atlas-count" style={{ padding: 8 }}>{search.total - search.results.length} more matches; refine the search.</p>}
        </div>
      ) : (
        <>
          <div className="atlas-explorer-head">
            <span className="atlas-count">{tree.name} · {tree.files.toLocaleString()} files</span>
            <button type="button" className="auth-link" onClick={() => useAtlasStore.getState().setTreeExpanded(new Set(['']))} title="Collapse every folder">
              <ChevronsDownUp size={13} style={{ verticalAlign: '-2px' }} /> Collapse all
            </button>
          </div>
          <div
            ref={listRef}
            className="atlas-panel-scroll atlas-tree"
            role="tree"
            aria-label="Repository files"
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onKeyDown={onKeyDown}
          >
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {rows.slice(first, last).map(({ node: n, depth }, k) => {
                const i = first + k;
                const isFolder = n.kind === 'folder';
                const open = isFolder && treeExpanded.has(n.path);
                const isSel = selectedPath === n.path;
                const skipped = n.kind.startsWith('skipped');
                return (
                  <div key={n.path} style={{ position: 'absolute', top: i * ROW_H, left: 0, right: 0, height: ROW_H }}>
                    <div
                      data-row={i}
                      role="treeitem"
                      aria-level={depth + 1}
                      aria-expanded={isFolder ? open : undefined}
                      aria-selected={isSel}
                      aria-current={isSel ? 'true' : undefined}
                      tabIndex={i === focusIndex ? 0 : -1}
                      className="atlas-row atlas-tree-row"
                      style={{ paddingLeft: 6 + depth * 14, opacity: skipped ? 0.6 : 1, cursor: 'pointer' }}
                      onClick={() => { setFocusIndex(i); activate(n); }}
                      onFocus={() => setFocusIndex(i)}
                      title={skipped ? `${n.path} (${skippedLabel(n)}: not part of the dependency graph)` : n.path}
                    >
                      <span style={{ width: 14, display: 'inline-flex', flexShrink: 0 }}>{isFolder ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</span>
                      {isFolder || n.kind === 'skipped-dir' ? (open ? <FolderOpen size={14} color="#FFD166" style={{ flexShrink: 0 }} /> : <Folder size={14} color={skipped ? '#77839C' : '#FFD166'} style={{ flexShrink: 0 }} />) : <FileIcon name={n.name} />}
                      <span className="atlas-grow" style={{ fontStyle: skipped ? 'italic' : undefined }}>{n.name}</span>
                      {badges(n)}
                      {isFolder ? <span className="atlas-count">{n.files}</span> : skipped ? <span className="atlas-count">{skippedLabel(n)}</span> : null}
                      {isFolder && model.folderByPath.has(n.path) && (
                        <button type="button" className="atlas-row-action" tabIndex={-1} aria-label={`Show ${n.name} on the map`} title="Show this folder on the map" onClick={(e) => { e.stopPropagation(); showFolderOnMap(n); }}>
                          <LocateFixed size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {note && (
            <div className="atlas-note" role="status">
              <strong>{note.name}</strong> is in <code>{note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '/'}</code>. It was not analysed ({skippedLabel(note)}), so it has no node and no dependency information.
              <button type="button" className="auth-link" onClick={() => setNote(null)} style={{ marginLeft: 6 }}>Dismiss</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
