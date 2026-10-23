import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Crosshair, ExternalLink, FileText, Folder, GitBranch, Package, RefreshCw, Route, X } from 'lucide-react';
import CodeViewer from '../../components/CodeViewer';
import { fetchFileSource, type FetchSourceResult } from '../../lib/fetchFileSource';
import { useAtlasStore, typeGroup } from './atlasStore';
import { RELATION_COLORS } from './palette';
import { isExternalPath, EXTERNAL_REASON } from './externals';
import { buildSearchIndex, search } from './search';
import { edgesBetweenTopFolders } from './render2d';
import type { AtlasModel, Edge, FileNode, FolderNode } from './model';

type Tab = 'code' | 'deps' | 'dependents' | 'findings' | 'details';

const formatBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const SEVERITY_COLOR = { error: '#FF717A', warning: '#FFD166', info: '#6898FF' } as const;

const LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.tsx': 'TypeScript (JSX)', '.js': 'JavaScript', '.mjs': 'JavaScript (ES module)',
  '.cjs': 'JavaScript (CommonJS)', '.jsx': 'JavaScript (JSX)', '.json': 'JSON', '.css': 'CSS', '.scss': 'SCSS', '.md': 'Markdown', '.html': 'HTML',
  '.svg': 'SVG image', '.yml': 'YAML', '.yaml': 'YAML', '.py': 'Python', '.go': 'Go', '.java': 'Java',
};
export const languageName = (f: FileNode) => LANGUAGE[f.ext] ?? (f.ext ? `${typeGroup(f.ext)} (${f.ext})` : 'No extension');

/** One row per target: resolved by file, external/unresolved by specifier. Keeps the first (lowest) line. */
function dedupe(edges: Edge[], key: (e: Edge) => string): Edge[] {
  const seen = new Map<string, Edge>();
  for (const e of edges) if (!seen.has(key(e))) seen.set(key(e), e);
  return [...seen.values()];
}

function LineChip({ line, onClick, title }: { line: number; onClick: () => void; title: string }) {
  return (
    <button type="button" className="atlas-badge" style={{ borderColor: 'rgba(135,155,255,0.35)', color: '#A99AFF', background: 'none', cursor: 'pointer', font: '10.5px var(--font-mono)' }} onClick={onClick} title={title} aria-label={title}>
      L{line}
    </button>
  );
}

function FileLink({ model, path, onClick, color, chip }: { model: AtlasModel; path: string; onClick: () => void; color: string; chip?: React.ReactNode }) {
  const f = model.fileByPath.get(path);
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button type="button" className="atlas-row" onClick={onClick} title={`Select ${path} on the map`}>
        <span className="atlas-dot" style={{ background: color }} />
        <span className="atlas-grow">
          <span style={{ color: '#EAF0FF' }}>{f?.name ?? path}</span>
          <span className="atlas-sub" style={{ display: 'block', font: '10.5px var(--font-mono)', color: '#77839C', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f?.folder || '/'}</span>
        </span>
        {model.cycleOf.has(path) && <span className="atlas-badge" style={{ color: RELATION_COLORS.cycle, borderColor: RELATION_COLORS.cycle }}>cycle</span>}
      </button>
      {chip}
    </li>
  );
}

function PanelHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="atlas-panel-title">{icon}<span>{title}</span></div>
        <div className="atlas-path" style={{ marginTop: 2 }}>{sub}</div>
      </div>
      <button type="button" className="atlas-icon-btn" style={{ width: 28, height: 28 }} onClick={() => useAtlasStore.getState().select(null)} aria-label="Close details and clear the selection" title="Clear selection (Esc)"><X size={14} /></button>
    </div>
  );
}

function CodeTab({ file }: { file: FileNode }) {
  const model = useAtlasStore((s) => s.model)!;
  const codeLine = useAtlasStore((s) => s.codeLine);
  const [state, setState] = useState<{ path: string; result: FetchSourceResult | null }>({ path: file.path, result: null });
  const [attempt, setAttempt] = useState(0);
  const repo = model.data.repo;

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ path: file.path, result: null });
    fetchFileSource({ owner: repo.owner, name: repo.name, source: repo.source }, file.path, repo.commitSha, { signal: ctrl.signal }).then((result) => {
      if (!ctrl.signal.aborted) setState({ path: file.path, result });
    });
    return () => ctrl.abort();
  }, [file.path, repo.owner, repo.name, repo.source, repo.commitSha, attempt]);

  const r = state.path === file.path ? state.result : null;
  if (!r) return <div className="atlas-count" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12 }}><RefreshCw size={14} className="spin" /> Loading source from GitHub…</div>;
  if (!r.ok) {
    return (
      <div style={{ padding: 12, fontSize: 12.5, color: '#B8BBCB' }}>
        <p style={{ margin: '0 0 8px' }}>{r.message}</p>
        {(r.code === 'timeout' || r.code === 'network' || r.code === 'rate-limited') && (
          <button type="button" className="atlas-btn" onClick={() => setAttempt((a) => a + 1)}><RefreshCw size={13} /> Try again</button>
        )}
      </div>
    );
  }
  const target = codeLine && codeLine.path === file.path ? { line: codeLine.line, nonce: codeLine.nonce } : null;
  return <CodeViewer code={r.text} path={file.path} target={target} />;
}

/** "Trace to…": pick another file and draw the shortest import chain. */
function TracePicker({ model, from }: { model: AtlasModel; from: string }) {
  const [q, setQ] = useState('');
  const index = useMemo(() => buildSearchIndex(model).filter((e) => e.kind === 'file' && e.path !== from), [model, from]);
  const results = useMemo(() => search(index, q, 8), [index, q]);
  return (
    <div style={{ marginTop: 6 }}>
      <input className="atlas-input" style={{ paddingLeft: 10, height: 30 }} placeholder="Trace the import chain to… (type a file name)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Target file for the dependency trace" autoFocus />
      {results.length > 0 && (
        <ul className="atlas-list" style={{ marginTop: 4 }}>
          {results.map((r) => (
            <li key={r.path}>
              <button type="button" className="atlas-row" onClick={() => { useAtlasStore.getState().setTrace(from, r.path); setQ(''); }}>
                <Route size={13} color="#37D9FF" style={{ flexShrink: 0 }} /><span className="atlas-grow">{r.name}</span><span className="atlas-count" style={{ maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileDetails({ model, file }: { model: AtlasModel; file: FileNode }) {
  const navigate = useNavigate();
  const repositoryId = useAtlasStore((s) => s.repositoryId);
  const codeLine = useAtlasStore((s) => s.codeLine);
  const isolate = useAtlasStore((s) => s.isolate);
  const trace = useAtlasStore((s) => s.trace);
  const findings = useAtlasStore((s) => s.findings.get(file.path) ?? []);
  const findingsNote = useAtlasStore((s) => s.findingsNote);
  const external = isExternalPath(file.path);
  const [tab, setTab] = useState<Tab>(external ? 'dependents' : 'code');
  const [tracing, setTracing] = useState(false);
  const store = useAtlasStore.getState;

  useEffect(() => { if (codeLine?.path === file.path) setTab('code'); }, [codeLine, file.path]);

  const outgoing = model.outgoing.get(file.path) ?? [];
  const resolved = dedupe(outgoing.filter((e) => e.status === 'resolved' && e.reason !== EXTERNAL_REASON), (e) => e.to!);
  const external_ = dedupe(outgoing.filter((e) => e.status === 'external' || e.reason === EXTERNAL_REASON), (e) => e.specifier);
  const unresolved = dedupe(outgoing.filter((e) => e.status === 'unresolved'), (e) => `${e.specifier}:${e.line}`);
  const dependents = dedupe(model.incoming.get(file.path) ?? [], (e) => e.from);
  const depCount = resolved.length + external_.length + unresolved.length;
  const cycleIdx = model.cycleOf.get(file.path);
  const cycle = cycleIdx !== undefined ? model.data.cycles[cycleIdx] : null;
  const showLine = (line: number) => store().scrollCodeTo(file.path, line);
  const isIsolated = isolate?.path === file.path;

  const tabs: Array<[Tab, string]> = external
    ? [['dependents', `Imported by (${dependents.length})`]]
    : [['code', 'Code'], ['deps', `Imports (${depCount})`], ['dependents', `Imported by (${dependents.length})`], ['findings', `Findings (${findings.length})`], ['details', 'Details']];
  const explorerUrl = repositoryId && !external ? `/explorer?repo=${encodeURIComponent(repositoryId)}&path=${encodeURIComponent(file.path)}` : null;

  return (
    <>
      <PanelHeader icon={external ? <Package size={15} style={{ color: '#FFD166', flexShrink: 0 }} /> : <FileText size={15} style={{ color: '#8EB5FF', flexShrink: 0 }} />} title={file.name} sub={external ? 'External package (not part of the repository)' : file.path} />
      {!external && (
        <div className="atlas-meta-row">
          <span>{languageName(file)}</span>
          <span>{file.lines.toLocaleString()} lines</span>
          <span title="Files this file imports">→ {resolved.length}</span>
          <span title="Files that import this file">← {dependents.length}</span>
          {cycle && <span style={{ color: RELATION_COLORS.cycle }}>cycle</span>}
          {findings.length > 0 && <span style={{ color: SEVERITY_COLOR[findings.some((f) => f.severity === 'error') ? 'error' : 'warning'] }}>{findings.length} finding{findings.length === 1 ? '' : 's'}</span>}
        </div>
      )}
      <div className="atlas-actions-row">
        <button type="button" className="atlas-btn atlas-btn-sm" onClick={() => store().focusSelection()} title="Move the camera to this file (F)"><Crosshair size={13} /> Focus</button>
        {!external && (
          <>
            <button type="button" className="atlas-btn atlas-btn-sm" aria-pressed={isIsolated} onClick={() => store().setIsolate(isIsolated ? null : file.path, isolate?.depth ?? 1)} title="Show only this file and its neighbours (I)">
              <GitBranch size={13} /> {isIsolated ? 'Exit isolation' : 'Isolate'}
            </button>
            {isIsolated && (
              <select className="atlas-input atlas-select-sm" value={isolate!.depth} onChange={(e) => store().setIsolate(file.path, Number(e.target.value) as 1 | 2 | 3)} aria-label="Isolation depth">
                <option value={1}>1 step</option><option value={2}>2 steps</option><option value={3}>3 steps</option>
              </select>
            )}
            <button type="button" className="atlas-btn atlas-btn-sm" aria-pressed={tracing || !!trace} onClick={() => { if (trace) { store().setTrace(null); setTracing(false); } else setTracing((v) => !v); }} title="Find the import chain to another file">
              <Route size={13} /> {trace ? 'Clear trace' : 'Trace to…'}
            </button>
          </>
        )}
      </div>
      {tracing && !trace && <TracePicker model={model} from={file.path} />}
      {trace && trace.from === file.path && (
        <div className="atlas-note" role="status" style={{ marginTop: 6 }}>
          {trace.path ? (
            <>
              <div style={{ marginBottom: 4 }}>{trace.reversed ? <>The chain runs the other way: <strong>{model.fileByPath.get(trace.to)?.name}</strong> imports this file through:</> : <>Import chain ({trace.path.length - 1} step{trace.path.length === 2 ? '' : 's'}):</>}</div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {trace.path.map((p, i) => (
                  <li key={p}>
                    <button type="button" className="auth-link" onClick={() => store().reveal({ type: 'file', path: p })}>{model.fileByPath.get(p)?.name ?? p}</button>
                    {trace.steps[i] && <span className="atlas-count"> imports on line {trace.steps[i].line}</span>}
                  </li>
                ))}
              </ol>
            </>
          ) : <>No import chain connects this file and <strong>{model.fileByPath.get(trace.to)?.name}</strong> in either direction.</>}
        </div>
      )}
      {explorerUrl && (
        <button type="button" className="auth-link" style={{ alignSelf: 'flex-start', margin: '6px 0 2px', fontSize: 12 }} onClick={() => navigate(explorerUrl)}>
          <ExternalLink size={12} style={{ verticalAlign: '-1px' }} /> Open in Code Explorer
        </button>
      )}

      <div className="atlas-tabs" role="tablist" aria-label="File details">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`atlas-tab-${id}`} aria-controls={`atlas-tabpanel-${id}`} aria-selected={tab === id} className="atlas-tab" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="atlas-panel-scroll" role="tabpanel" id={`atlas-tabpanel-${tab}`} aria-labelledby={`atlas-tab-${tab}`} style={tab === 'code' ? { overflow: 'hidden' } : undefined}>
        {tab === 'code' && <CodeTab file={file} />}

        {tab === 'deps' && (
          <>
            {depCount === 0 && <p className="atlas-count">{file.kind === 'code' ? 'This file imports nothing.' : 'No dependency information for this file type.'}</p>}
            {resolved.length > 0 && <div className="atlas-section">Files in the repository ({resolved.length})</div>}
            <ul className="atlas-list">
              {resolved.map((e) => (
                <FileLink key={e.to} model={model} path={e.to!} color={model.cycleEdges.has(e) ? RELATION_COLORS.cycle : RELATION_COLORS.dependency}
                  onClick={() => store().reveal({ type: 'file', path: e.to! })}
                  chip={<LineChip line={e.line} onClick={() => showLine(e.line)} title={`Show the import on line ${e.line}`} />} />
              ))}
            </ul>
            {external_.length > 0 && <div className="atlas-section">External packages ({external_.length})</div>}
            <ul className="atlas-list">
              {external_.map((e) => (
                <li key={e.specifier} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12 }}>
                  <span className="atlas-grow" style={{ font: '11.5px var(--font-mono)', color: '#EAF0FF' }}>{e.specifier}</span>
                  <span className="atlas-badge" style={{ color: '#A7B4CC', borderColor: 'rgba(167,180,204,0.35)' }}>{e.reason === 'built-in module' ? 'built-in' : e.reason === 'URL import' ? 'URL' : 'package'}</span>
                  <LineChip line={e.line} onClick={() => showLine(e.line)} title={`Show the import on line ${e.line}`} />
                </li>
              ))}
            </ul>
            {unresolved.length > 0 && <div className="atlas-section">Unresolved ({unresolved.length})</div>}
            <ul className="atlas-list">
              {unresolved.map((e) => (
                <li key={`${e.specifier}:${e.line}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12 }}>
                  <span className="atlas-grow" style={{ font: '11.5px var(--font-mono)', color: '#EAF0FF' }} title={e.specifier}>{e.specifier}</span>
                  <span className="atlas-badge" style={{ color: '#FFD166', borderColor: 'rgba(255,209,102,0.45)' }} title="Not drawn on the map: the target could not be determined">unknown · {e.reason}</span>
                  <LineChip line={e.line} onClick={() => showLine(e.line)} title={`Show the import on line ${e.line}`} />
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'dependents' && (
          <>
            {dependents.length === 0 && <p className="atlas-count">No file in this repository imports this {external ? 'package' : 'file'}.</p>}
            <ul className="atlas-list">
              {dependents.map((e) => (
                <FileLink key={e.from} model={model} path={e.from} color={model.cycleEdges.has(e) ? RELATION_COLORS.cycle : RELATION_COLORS.dependent}
                  onClick={() => { store().reveal({ type: 'file', path: e.from }); store().scrollCodeTo(e.from, e.line); }}
                  chip={<span className="atlas-count" style={{ font: '10.5px var(--font-mono)' }} title={`Imported on line ${e.line} of that file`}>L{e.line}</span>} />
              ))}
            </ul>
          </>
        )}

        {tab === 'findings' && (
          <>
            {findingsNote && <p className="atlas-count">{findingsNote}</p>}
            {!findingsNote && findings.length === 0 && <p className="atlas-count">No architectural findings for this file.</p>}
            <ul className="atlas-list">
              {findings.map((f, i) => (
                <li key={f.id ?? `${f.rule}-${i}`} className="atlas-finding">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="atlas-badge" style={{ color: SEVERITY_COLOR[f.severity], borderColor: SEVERITY_COLOR[f.severity] }}>{f.severity}</span>
                    <strong style={{ fontSize: 12, color: '#EAF0FF' }}>{f.rule}</strong>
                    {f.confidence && <span className="atlas-count">{f.confidence === 'confirmed' ? 'confirmed' : 'heuristic'}</span>}
                    {typeof f.line === 'number' && <LineChip line={f.line} onClick={() => showLine(f.line!)} title={`Show line ${f.line}`} />}
                  </div>
                  <div style={{ fontSize: 12, color: '#B8BBCB', marginTop: 3 }}>{f.description}</div>
                  {(f.affectedFiles ?? []).filter((p) => p !== file.path).length > 0 && (
                    <div style={{ fontSize: 11, color: '#77839C', marginTop: 3 }}>
                      Also involves:{' '}
                      {(f.affectedFiles ?? []).filter((p) => p !== file.path).slice(0, 6).map((p) => (
                        <button key={p} type="button" className="auth-link" style={{ marginRight: 6, fontSize: 11 }} onClick={() => store().reveal({ type: 'file', path: p })} disabled={!model.fileByPath.has(p)}>{p.split('/').pop()}</button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'details' && (
          <>
            <dl className="atlas-kv">
              <dt>Path</dt><dd className="atlas-path">{file.path}</dd>
              <dt>Language</dt><dd>{languageName(file)}</dd>
              <dt>Type</dt><dd>{file.kind === 'code' ? 'Source code' : file.kind === 'asset' ? 'Asset (imported by code)' : 'Other file'}</dd>
              <dt>Size</dt><dd>{formatBytes(file.size)}</dd>
              <dt>Lines</dt><dd>{file.lines.toLocaleString()}</dd>
              {file.kind === 'code' && <><dt>Complexity</dt><dd>{file.complexity ?? 'unknown (file could not be parsed)'}</dd></>}
              {file.kind === 'code' && <><dt>Tokens</dt><dd>{file.tokens?.toLocaleString() ?? 'unknown'}</dd></>}
              {file.exports.length > 0 && <><dt>Exports</dt><dd style={{ font: '11.5px var(--font-mono)' }}>{file.exports.join(', ')}</dd></>}
              {file.parseError && <><dt>Parse error</dt><dd style={{ color: '#FFD166' }}>{file.parseError}</dd></>}
              <dt>Circular</dt><dd style={{ color: cycle ? RELATION_COLORS.cycle : undefined }}>{cycle ? `Yes: part of a cycle of ${cycle.length} files` : 'No'}</dd>
            </dl>
            {cycle && (
              <>
                <div className="atlas-section" style={{ color: RELATION_COLORS.cycle }}>Cycle members</div>
                <ul className="atlas-list">
                  {cycle.map((p) => <FileLink key={p} model={model} path={p} color={RELATION_COLORS.cycle} onClick={() => store().reveal({ type: 'file', path: p })} />)}
                </ul>
              </>
            )}
            <div className="atlas-section">Functions &amp; classes ({file.functions.length})</div>
            {file.functions.length === 0 && <p className="atlas-count">{file.kind === 'code' ? 'No named functions or classes.' : 'Not applicable for this file type.'}</p>}
            <ul className="atlas-list">
              {file.functions.map((fn) => (
                <li key={`${fn.name}:${fn.line}`}>
                  <button type="button" className="atlas-row" onClick={() => showLine(fn.line)} title={`Show line ${fn.line}`}>
                    <span className="atlas-badge" style={{ color: fn.kind === 'class' ? '#37D9FF' : fn.kind === 'method' ? '#A99AFF' : '#8EB5FF', borderColor: 'currentColor' }}>{fn.kind}</span>
                    <span className="atlas-grow" style={{ font: '11.5px var(--font-mono)' }}>{fn.name}</span>
                    <span className="atlas-count">L{fn.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

/** A selected connection: every import statement between the two files, both directions. */
function LinkDetails({ model, from, to }: { model: AtlasModel; from: string; to: string }) {
  const store = useAtlasStore.getState;
  const fwd = (model.outgoing.get(from) ?? []).filter((e) => e.to === to);
  const back = (model.outgoing.get(to) ?? []).filter((e) => e.to === from);
  const a = model.fileByPath.get(from);
  const b = model.fileByPath.get(to);
  const cyc = [...fwd, ...back].some((e) => model.cycleEdges.has(e));
  const rows = (es: Edge[], importer: string) => es.map((e) => (
    <li key={`${e.from}:${e.line}:${e.specifier}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12 }}>
      <span className="atlas-badge" style={{ color: '#A99AFF', borderColor: 'rgba(139,120,255,0.4)' }}>{e.kind}</span>
      <code className="atlas-grow" style={{ fontSize: 11.5, color: '#EAF0FF' }}>{e.specifier}</code>
      <LineChip line={e.line} onClick={() => { store().reveal({ type: 'file', path: importer }); store().scrollCodeTo(importer, e.line); }} title={`Open ${importer.split('/').pop()} at line ${e.line}`} />
    </li>
  ));
  return (
    <>
      <PanelHeader icon={<ArrowRight size={15} style={{ color: '#EAF0FF', flexShrink: 0 }} />} title={`${a?.name ?? from} → ${b?.name ?? to}`} sub={`${a?.name ?? from} imports ${b?.name ?? to}`} />
      <div className="atlas-panel-scroll">
        {cyc && <p style={{ color: RELATION_COLORS.cycle, fontSize: 12, margin: '0 0 8px' }}>These files are part of a circular dependency.</p>}
        <div className="atlas-section">{a?.name} imports {b?.name} ({fwd.length})</div>
        <ul className="atlas-list">{rows(fwd, from)}</ul>
        {back.length > 0 && (
          <>
            <div className="atlas-section">{b?.name} also imports {a?.name} ({back.length})</div>
            <ul className="atlas-list">{rows(back, to)}</ul>
          </>
        )}
        <div className="atlas-section">Files</div>
        <ul className="atlas-list">
          <FileLink model={model} path={from} color={RELATION_COLORS.dependent} onClick={() => store().reveal({ type: 'file', path: from })} />
          <FileLink model={model} path={to} color={RELATION_COLORS.dependency} onClick={() => store().reveal({ type: 'file', path: to })} />
        </ul>
        <button type="button" className="atlas-btn atlas-btn-sm" style={{ marginTop: 10 }} onClick={() => store().setTrace(from, to)}><Route size={13} /> Show as a trace</button>
      </div>
    </>
  );
}

/** A selected folder-to-folder line (zoomed-out Show all). */
function FolderLinkDetails({ model, from, to }: { model: AtlasModel; from: string; to: string }) {
  const store = useAtlasStore.getState;
  const edges = useMemo(() => edgesBetweenTopFolders(model, from, to), [model, from, to]);
  const name = (k: string) => model.folderByPath.get(k)?.name ?? k;
  const shown = edges.slice(0, 200);
  return (
    <>
      <PanelHeader icon={<ArrowRight size={15} style={{ color: '#EAF0FF', flexShrink: 0 }} />} title={`${name(from)} → ${name(to)}`} sub={`${edges.length} import${edges.length === 1 ? '' : 's'} from ${name(from)}/ into ${name(to)}/`} />
      <div className="atlas-panel-scroll">
        <ul className="atlas-list">
          {shown.map((e) => (
            <li key={`${e.from}:${e.line}:${e.to}`}>
              <button type="button" className="atlas-row" onClick={() => store().select({ type: 'link', from: e.from, to: e.to! })}>
                <span className="atlas-grow">{e.from.split('/').pop()} <span className="atlas-count">→</span> {e.to!.split('/').pop()}</span>
                <span className="atlas-count">L{e.line}</span>
              </button>
            </li>
          ))}
        </ul>
        {edges.length > shown.length && <p className="atlas-count">…and {edges.length - shown.length} more. Zoom in to see individual links.</p>}
      </div>
    </>
  );
}

function FolderDetails({ model, folder }: { model: AtlasModel; folder: FolderNode }) {
  const expanded = useAtlasStore((s) => s.expanded.has(folder.path));
  const store = useAtlasStore.getState;
  const code = folder.files.filter((f) => f.kind === 'code').length;
  return (
    <>
      <PanelHeader icon={<Folder size={15} style={{ color: '#FFD166', flexShrink: 0 }} />} title={`${folder.name}/`} sub={folder.path || '/'} />
      <dl className="atlas-kv" style={{ marginBottom: 8 }}>
        <dt>Files (all)</dt><dd>{folder.totalFiles}</dd>
        <dt>Directly here</dt><dd>{folder.files.length} ({code} code)</dd>
        <dt>Subfolders</dt><dd>{folder.folders.length}</dd>
      </dl>
      <div className="atlas-actions-row">
        <button type="button" className="atlas-btn atlas-btn-sm" onClick={() => store().toggleFolder(folder.path)} aria-pressed={expanded}>{expanded ? 'Collapse on map' : 'Expand on map'}</button>
        <button type="button" className="atlas-btn atlas-btn-sm" onClick={() => store().focusSelection()}><Crosshair size={13} /> Focus</button>
      </div>
      <div className="atlas-panel-scroll">
        {folder.folders.length > 0 && <div className="atlas-section">Subfolders</div>}
        <ul className="atlas-list">
          {folder.folders.map((f) => (
            <li key={f.path}>
              <button type="button" className="atlas-row" onClick={() => store().reveal({ type: 'folder', path: f.path })}>
                <Folder size={13} style={{ color: '#FFD166', flexShrink: 0 }} /><span className="atlas-grow">{f.name}/</span><span className="atlas-count">{f.totalFiles}</span>
              </button>
            </li>
          ))}
        </ul>
        {folder.files.length > 0 && <div className="atlas-section">Files</div>}
        <ul className="atlas-list">
          {folder.files.slice(0, 300).map((f) => (
            <li key={f.path}>
              <button type="button" className="atlas-row" onClick={() => store().reveal({ type: 'file', path: f.path })}>
                <FileText size={13} style={{ color: '#8EB5FF', flexShrink: 0 }} /><span className="atlas-grow">{f.name}</span>
                <span className="atlas-count" title="imports / imported by">{(model.outgoing.get(f.path) ?? []).filter((e) => e.status === 'resolved').length}↗ {(model.incoming.get(f.path) ?? []).length}↙</span>
              </button>
            </li>
          ))}
          {folder.files.length > 300 && <li className="atlas-count" style={{ padding: 6 }}>…and {folder.files.length - 300} more (use search)</li>}
        </ul>
      </div>
    </>
  );
}

export default function DetailsPanel() {
  const model = useAtlasStore((s) => s.model);
  const selected = useAtlasStore((s) => s.selected);
  if (!model || !selected) return null;
  if (selected.type === 'file') {
    const file = model.fileByPath.get(selected.path);
    return file ? <FileDetails key={file.path} model={model} file={file} /> : null;
  }
  if (selected.type === 'folder') {
    const folder = model.folderByPath.get(selected.path);
    return folder ? <FolderDetails model={model} folder={folder} /> : null;
  }
  if (selected.type === 'link') return <LinkDetails model={model} from={selected.from} to={selected.to} />;
  return <FolderLinkDetails model={model} from={selected.from} to={selected.to} />;
}
