import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Compass, Map as MapIcon, Minimize2, Network, Package, PanelRightClose, PanelRightOpen, RefreshCw, RotateCw } from 'lucide-react';
import '../features/atlas/atlas.css';
import AtlasCanvas2D from '../features/atlas/AtlasCanvas2D';
import DetailsPanel from '../features/atlas/DetailsPanel';
import FiltersMenu from '../features/atlas/FiltersMenu';
import SearchBox from '../features/atlas/SearchBox';
import RepoExplorer from '../features/atlas/RepoExplorer';
import { EXTERNAL_REASON } from '../features/atlas/externals';
import { fetchAtlas } from '../features/atlas/atlasApi';
import { useAtlasStore } from '../features/atlas/atlasStore';
import { parseAtlasData, type AtlasData } from '../features/atlas/model';
import { RELATION_COLORS } from '../features/atlas/palette';
import type { AtlasLayout } from '../features/atlas/layout';
import { api, ApiError, type AnalysisStage, type IArchitecturalIssue, type RepositorySummary } from '../lib/api';
import { useRepositoryStore } from '../context/repositoryStore';

/** Largest repository the browser view accepts (the server caps analyses at 5,000 files today). */
const MAX_FILES = 20000;
/** The 3D view is built last; until then its toggle is hidden instead of doing nothing. */
const HAS_3D = false;
const STAGE_LABEL: Record<AnalysisStage, string> = { downloading: 'Downloading', extracting: 'Extracting', analyzing: 'Analyzing', saving: 'Saving' };

type View =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'no-repositories' }
  | { kind: 'analyzing'; message: string }
  | { kind: 'no-map'; title: string; message: string; canReanalyze: boolean }
  | { kind: 'error'; message: string; retry: boolean };

/** Dev-only data sources: ?sample=1 (this project, real analyzer output) and ?synthetic=N (generated). */
async function devData(): Promise<{ data: AtlasData; note: string } | null> {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  const synthetic = Number(params.get('synthetic') || 0);
  if (synthetic > 0) {
    const { syntheticAtlas } = await import('../features/atlas/dev/synthetic');
    return { data: syntheticAtlas(Math.min(synthetic, MAX_FILES)), note: `Synthetic test data (${synthetic.toLocaleString()} generated files) for performance testing. This is not a real repository.` };
  }
  if (params.has('sample')) {
    const { default: url } = await import('../features/atlas/sample/atlas-sample.json?url');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the sample analysis (${res.status}).`);
    const data = parseAtlasData(await res.json());
    return { data, note: `Sample analysis (dev only): ${data.repo.owner}/${data.repo.name} at commit ${data.repo.commitSha.slice(0, 7)}.` };
  }
  return null;
}

/**
 * Architectural findings for the map's files, from the existing repository-details endpoint.
 * Only used when that analysis is the one the map was built from (same commit); otherwise the panel says why.
 */
async function loadFindings(repositoryId: string, data: AtlasData) {
  const apply = (m: Map<string, IArchitecturalIssue[]>, note: string | null) => {
    if (useAtlasStore.getState().repositoryId === repositoryId) useAtlasStore.getState().setFindings(m, note);
  };
  try {
    const a = (await api.getRepositoryDetails(repositoryId)).latestAnalysis;
    if (!a) return apply(new Map(), 'No analysis results are available, so there are no findings to show.');
    if ((a.commitSha ?? '') !== (data.repo.commitSha ?? '')) return apply(new Map(), 'Findings are not shown: they belong to a different analysis than this map. Re-analyze to bring both in line.');
    const m = new Map<string, IArchitecturalIssue[]>();
    for (const issue of a.issues ?? []) for (const p of new Set([issue.file, ...(issue.affectedFiles ?? [])])) (m.get(p) ?? m.set(p, []).get(p)!).push(issue);
    apply(m, null);
  } catch {
    apply(new Map(), 'Architectural findings could not be loaded.');
  }
}

export default function DependencyAtlas() {
  const status = useAtlasStore((s) => s.status);
  const model = useAtlasStore((s) => s.model);
  const selected = useAtlasStore((s) => s.selected);
  const showAll = useAtlasStore((s) => s.showAll);
  const showDependencies = useAtlasStore((s) => s.showDependencies);
  const showDependents = useAtlasStore((s) => s.showDependents);
  const cyclesOnly = useAtlasStore((s) => s.filters.cyclesOnly);
  const viewMode = useAtlasStore((s) => s.viewMode);
  const repositories = useRepositoryStore((s) => s.repositories);
  const selectedRepo = useRepositoryStore((s) => s.selectedRepo);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [note, setNote] = useState<string | null>(null);
  const [colorByTop, setColorByTop] = useState<Map<string, string>>(new Map());
  const [reload, setReload] = useState(0);
  const [reanalyzing, setReanalyzing] = useState<{ stage: AnalysisStage | null; message: string } | null>(null);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const showExternal = useAtlasStore((s) => s.showExternal);
  const findingsOnly = useAtlasStore((s) => s.filters.findingsOnly);
  const findings = useAtlasStore((s) => s.findings);

  const repo: RepositorySummary | null = selectedRepo ?? repositories[0] ?? null;
  const repoId = repo?._id ?? null;

  // Deep link from other pages (e.g. the Onboarding Pathfinder): ?repo=<id>&file=<path>&line=<n>
  const [searchParams, setSearchParams] = useSearchParams();
  const linkRepo = searchParams.get('repo');
  const linkFile = searchParams.get('file');
  const linkLine = Number(searchParams.get('line')) || 0;
  useEffect(() => {
    if (!linkRepo || linkRepo === repoId) return;
    const target = repositories.find((r) => r._id === linkRepo);
    if (target) useRepositoryStore.getState().setSelectedRepo(target);
  }, [linkRepo, repoId, repositories]);

  // ---- data loading -------------------------------------------------------------------------------
  useEffect(() => {
    const ctrl = new AbortController();
    const atlas = useAtlasStore.getState();
    let timer = 0;
    setView({ kind: 'loading' });
    setNote(null);
    atlas.setLoading();

    const loadMap = async (target: RepositorySummary) => {
      if (target.analysisStatus === 'analyzing' || target.analysisStatus === 'pending') {
        // wait for the running analysis with real stages from /status, then load its map
        const st = await api.getRepositoryStatus(target._id).catch(() => null);
        if (ctrl.signal.aborted) return;
        if (st && (st.status === 'analyzing' || st.status === 'pending')) {
          setView({ kind: 'analyzing', message: st.stage ? `${STAGE_LABEL[st.stage]}… ${st.message ?? ''}` : st.message || 'Analysis in progress…' });
          timer = window.setTimeout(() => { if (!ctrl.signal.aborted) loadMap({ ...target, analysisStatus: st.status }); }, 2000);
          return;
        }
      }
      const r = await fetchAtlas(target._id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (r.ok) {
        if (r.data.files.length > MAX_FILES) {
          setView({ kind: 'no-map', title: 'Repository too large to map', message: `This repository has ${r.data.files.length.toLocaleString()} files, more than the ${MAX_FILES.toLocaleString()} the map can display.`, canReanalyze: false });
          return;
        }
        atlas.load(r.data, target._id);
        void loadFindings(target._id, r.data);
        if (target.analysisStatus === 'failed') setNote(`The latest analysis of ${target.fullName} failed (${target.statusMessage || 'no message'}). This map shows the previous successful analysis.`);
        setView({ kind: 'ready' });
        return;
      }
      switch (r.code) {
        case 'NO_ATLAS':
          setView({ kind: 'no-map', title: 'Map not available for this analysis', message: `${r.message} Analyses made before the Dependency Atlas existed, or whose map could not be saved, have no map.`, canReanalyze: true });
          break;
        case 'NO_ANALYSIS':
          setView({ kind: 'no-map', title: 'No completed analysis yet', message: target.analysisStatus === 'failed' ? `The analysis failed: ${target.statusMessage || 'unknown error'}.` : r.message, canReanalyze: true });
          break;
        case 'TOO_LARGE':
          setView({ kind: 'no-map', title: 'Repository too large to map', message: r.message, canReanalyze: false });
          break;
        default:
          setView({ kind: 'error', message: r.message, retry: r.code !== 'AUTH' });
      }
    };

    (async () => {
      try {
        const dev = await devData();
        if (ctrl.signal.aborted) return;
        if (dev) {
          setDevMode(true);
          atlas.load(dev.data, null);
          atlas.setFindings(new Map(), 'Architectural findings are only available for analysed repositories.');
          setNote(dev.note);
          setView({ kind: 'ready' });
          return;
        }
        let repos = useRepositoryStore.getState().repositories;
        if (!repos.length) {
          repos = await api.getRepositories();
          if (ctrl.signal.aborted) return;
          useRepositoryStore.getState().setRepositories(repos);
        }
        const target = repos.find((r) => r._id === repoId) ?? repos[0];
        if (!target) { setView({ kind: 'no-repositories' }); return; }
        await loadMap(target);
      } catch (err) {
        if (!ctrl.signal.aborted) setView({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load the dependency map.', retry: true });
      }
    })();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [repoId, reload]);

  // ---- re-analyze (existing API action, force=true) ------------------------------------------------
  const reanalyze = async () => {
    if (!repo || repo.source !== 'github') return;
    setReanalyzeError(null);
    setReanalyzing({ stage: null, message: 'Starting analysis…' });
    const poll = window.setInterval(async () => {
      const st = await api.getRepositoryStatus(repo._id).catch(() => null);
      if (st?.status === 'analyzing') setReanalyzing({ stage: st.stage ?? null, message: st.message || 'Analyzing…' });
    }, 2000);
    try {
      await api.analyzeGitHub(repo.githubUrl || `https://github.com/${repo.owner}/${repo.name}`, true);
      useRepositoryStore.getState().setRepositories(await api.getRepositories());
      setReload((n) => n + 1);
    } catch (err) {
      setReanalyzeError(err instanceof ApiError || err instanceof Error ? err.message : 'Re-analysis failed.');
    } finally {
      clearInterval(poll);
      setReanalyzing(null);
    }
  };

  // Escape steps back one level: isolation -> trace -> selection / Show all -> fullscreen.
  // Inputs and popovers handle their own Escape first. "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        (document.querySelector('.atlas-header input[role="combobox"]') as HTMLInputElement | null)?.focus();
        return;
      }
      if (e.key !== 'Escape' || typing) return;
      if (!useAtlasStore.getState().escape()) setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // fullscreen is an application-level overlay; the page behind it must not scroll
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // open the linked file once its map is shown, then drop the parameters so a reload does not repeat it
  useEffect(() => {
    if (view.kind !== 'ready' || status !== 'ready' || !model || !linkFile || (linkRepo && linkRepo !== repoId)) return;
    if (model.fileByPath.has(linkFile)) {
      useAtlasStore.getState().reveal({ type: 'file', path: linkFile });
      if (linkLine > 0) useAtlasStore.getState().scrollCodeTo(linkFile, linkLine);
    } else {
      setNote(`${linkFile} is not part of this repository's map.`);
    }
    setSearchParams({}, { replace: true });
  }, [view.kind, status, model, linkFile, linkLine, linkRepo, repoId, setSearchParams]);

  const onLayout = useCallback((l: AtlasLayout) => setColorByTop(l.colorByTop), []);
  const store = useAtlasStore.getState;
  const ready = view.kind === 'ready' && status === 'ready';
  const stats = ready ? model?.data.stats : undefined;
  const cycles = model?.data.cycles.length ?? 0;
  const findingFiles = findings.size;

  const reanalyzeControls = repo && (
    repo.source === 'github' ? (
      <button type="button" className="atlas-btn" style={{ marginTop: 14 }} onClick={reanalyze} disabled={!!reanalyzing}>
        {reanalyzing ? <RefreshCw size={13} className="spin" /> : <RotateCw size={13} />} {reanalyzing ? 'Re-analyzing…' : 'Re-analyze'}
      </button>
    ) : (
      <p style={{ marginTop: 12 }}>
        ZIP uploads cannot be re-sent from here. <Link to="/home" className="auth-link">Re-upload the ZIP on the Home page</Link>.
      </p>
    )
  );

  return (
    <div className={`atlas-page${fullscreen ? ' is-fullscreen' : ''}`} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? 'Dependency Atlas, fullscreen' : undefined}>
      <header className="atlas-header">
        <div style={{ minWidth: 0 }}>
          {!fullscreen && <nav className="atlas-crumb" aria-label="Breadcrumb">
            <Link to="/home" aria-label="Back to Home"><ChevronLeft size={14} /></Link>
            <span>/</span><span aria-current="page">Dependency Atlas</span>
          </nav>}
          <h1 className="page-title">Dependency Atlas</h1>
          {!fullscreen && <p className="page-sub">Visualize how your codebase connects. Explore files, folders and their relationships.</p>}
        </div>
        <div className="atlas-actions">
          {!devMode && repositories.length > 0 && (
            <select
              className="atlas-input"
              style={{ width: 230, paddingLeft: 10 }}
              value={repoId ?? ''}
              onChange={(e) => useRepositoryStore.getState().setSelectedRepo(repositories.find((r) => r._id === e.target.value) ?? null)}
              aria-label="Repository"
            >
              {repositories.map((r) => <option key={r._id} value={r._id}>{r.fullName}</option>)}
            </select>
          )}
          <SearchBox />
          {HAS_3D && (
            <div role="group" aria-label="View mode" style={{ display: 'flex', gap: 4 }}>
              {(['2d', '3d'] as const).map((m) => (
                <button key={m} type="button" className="atlas-btn" aria-pressed={viewMode === m} onClick={() => store().setViewMode(m)}>{m.toUpperCase()}</button>
              ))}
            </div>
          )}
          <button type="button" className="atlas-btn" aria-pressed={showAll} disabled={!ready} onClick={() => store().setToggle('showAll', !showAll)}>
            <Network size={15} /> {showAll ? 'Hide All Dependencies' : 'Show All Dependencies'}
          </button>
          {fullscreen && (
            <button type="button" className="atlas-btn" onClick={() => setFullscreen(false)} title="Exit fullscreen (Esc)">
              <Minimize2 size={15} /> Exit fullscreen
            </button>
          )}
        </div>
      </header>

      {note && ready && !fullscreen && <div className="atlas-notice" role="note">{note}</div>}
      {reanalyzeError && <div className="atlas-notice" role="alert" style={{ color: '#FF949C' }}>{reanalyzeError}</div>}

      {ready && model && (
        <div className="atlas-toolbar" role="toolbar" aria-label="Relationship display">
          <button type="button" className="atlas-chip" aria-pressed={showDependencies} onClick={() => store().setToggle('showDependencies', !showDependencies)} title="When a file is selected, draw the files it imports">
            <span className="atlas-dot" style={{ background: RELATION_COLORS.dependency }} /> Dependencies
          </button>
          <button type="button" className="atlas-chip" aria-pressed={showDependents} onClick={() => store().setToggle('showDependents', !showDependents)} title="When a file is selected, draw the files that import it">
            <span className="atlas-dot" style={{ background: RELATION_COLORS.dependent }} /> Dependents
          </button>
          <button type="button" className="atlas-chip" aria-pressed={cyclesOnly} disabled={!cycles} onClick={() => store().setFilters({ cyclesOnly: !cyclesOnly })} title={cycles ? 'Show only files in circular dependencies' : 'No circular dependencies were found'}>
            <span className="atlas-dot" style={{ background: RELATION_COLORS.cycle }} /> Cycles ({cycles})
          </button>
          <button type="button" className="atlas-chip" aria-pressed={findingsOnly} disabled={!findingFiles} onClick={() => store().setFilters({ findingsOnly: !findingsOnly })} title={findingFiles ? 'Show only files with architectural findings' : 'No architectural findings for this map'}>
            <AlertTriangle size={12} color="#FFD166" /> Findings ({findingFiles})
          </button>
          <button type="button" className="atlas-chip" aria-pressed={showExternal} onClick={() => store().setShowExternal(!showExternal)} title="Show imported npm packages and built-in modules as nodes (diamonds) in their own group">
            <Package size={12} /> External packages
          </button>
          <FiltersMenu colorByTop={colorByTop} />
          {stats && (
            <span className="atlas-stat" style={{ marginLeft: 'auto' }}>
              <strong>{stats.files.toLocaleString()}</strong> files · <strong>{model.data.edges.filter((e) => e.status === 'resolved' && e.reason !== EXTERNAL_REASON).length.toLocaleString()}</strong> links ·{' '}
              <strong>{stats.unresolved.toLocaleString()}</strong> unresolved{stats.parseErrors ? <> · <strong>{stats.parseErrors}</strong> parse errors</> : null}
              {selected === null && !showAll && ' · click a file to see its connections'}
            </span>
          )}
        </div>
      )}

      <div className={`atlas-body${panelCollapsed ? ' is-panel-collapsed' : ''}`}>
        <section className="atlas-main card" aria-label="Dependency map">
          {view.kind === 'loading' && (
            <div className="atlas-state" role="status"><div><RefreshCw size={22} className="spin" style={{ color: '#8B78FF' }} /><h2>Loading the dependency map…</h2></div></div>
          )}
          {(view.kind === 'analyzing' || reanalyzing) && view.kind !== 'ready' && (
            <div className="atlas-state" role="status">
              <div>
                <RefreshCw size={22} className="spin" style={{ color: '#8B78FF' }} />
                <h2>Analysis in progress</h2>
                <p>{reanalyzing ? `${reanalyzing.stage ? `${STAGE_LABEL[reanalyzing.stage]}… ` : ''}${reanalyzing.message}` : view.kind === 'analyzing' ? view.message : ''}</p>
              </div>
            </div>
          )}
          {view.kind === 'no-map' && !reanalyzing && (
            <div className="atlas-state">
              <div>
                <MapIcon size={26} color="#8B78FF" />
                <h2>{view.title}</h2>
                <p>{view.message}</p>
                {view.canReanalyze && reanalyzeControls}
              </div>
            </div>
          )}
          {view.kind === 'no-repositories' && (
            <div className="atlas-state">
              <div>
                <Compass size={26} color="#8B78FF" />
                <h2>No analysis yet</h2>
                <p>Analyze a repository on the Home page, then come back to explore its map.</p>
                <Link to="/home" className="atlas-btn" style={{ marginTop: 14 }}>Go to Home</Link>
              </div>
            </div>
          )}
          {view.kind === 'error' && (
            <div className="atlas-state" role="alert">
              <div>
                <AlertCircle size={26} color="#FF717A" />
                <h2>The map could not be shown</h2>
                <p>{view.message}</p>
                {view.retry && <button type="button" className="atlas-btn" style={{ marginTop: 14 }} onClick={() => setReload((n) => n + 1)}><RefreshCw size={13} /> Try again</button>}
              </div>
            </div>
          )}
          {ready && <AtlasCanvas2D onLayout={onLayout} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen((v) => !v)} />}
          {ready && (
            <button type="button" className="atlas-icon-btn atlas-panel-toggle" onClick={() => setPanelCollapsed((v) => !v)} aria-expanded={!panelCollapsed} aria-controls="atlas-side-panel" aria-label={panelCollapsed ? 'Show the side panel' : 'Hide the side panel'} title={panelCollapsed ? 'Show the side panel' : 'Hide the side panel (more room for the map)'}>
              {panelCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
            </button>
          )}
          {view.kind === 'ready' && status === 'empty' && (
            <div className="atlas-state"><div><Compass size={26} color="#8B78FF" /><h2>This repository has no files to map</h2></div></div>
          )}
        </section>

        {!panelCollapsed && (
          <aside id="atlas-side-panel" className="atlas-side card" aria-label="Repository explorer and details">
            {ready ? (
              <>
                <section className={`atlas-side-section atlas-explorer-section${explorerCollapsed ? ' is-collapsed' : ''}${selected ? ' has-details' : ''}`} aria-label="Repository explorer">
                  <button type="button" className="atlas-section-head" onClick={() => setExplorerCollapsed((v) => !v)} aria-expanded={!explorerCollapsed}>
                    {explorerCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />} Repository Explorer
                  </button>
                  {!explorerCollapsed && <RepoExplorer />}
                </section>
                {selected && (
                  <section className="atlas-side-section atlas-details-section" aria-label="Selection details">
                    <DetailsPanel />
                  </section>
                )}
              </>
            ) : <p className="atlas-count">The repository explorer appears when the map is ready.</p>}
          </aside>
        )}
      </div>
    </div>
  );
}
