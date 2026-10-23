import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronLeft, Compass, RefreshCw, Sprout, Users } from 'lucide-react';
import '../features/pathfinder/pathfinder.css';
import { fetchAtlas } from '../features/atlas/atlasApi';
import { parseAtlasData, type AtlasData } from '../features/atlas/model';
import type { SearchResult } from '../features/atlas/search';
import BeginnerPath, { ProgressPanel, type PathRepo } from '../features/pathfinder/BeginnerPath';
import ContributorPath from '../features/pathfinder/ContributorPath';
import PathSearch, { type SearchPick } from '../features/pathfinder/PathSearch';
import { buildLearningPath } from '../features/pathfinder/learningPath';
import { deriveOpportunities } from '../features/pathfinder/opportunities';
import { buildRepoFacts } from '../features/pathfinder/repoFacts';
import { usePathfinderStore, type Mode } from '../features/pathfinder/pathfinderStore';
import { api, type AnalysisStage, type IArchitecturalIssue, type RepositorySummary } from '../lib/api';
import { useRepositoryStore } from '../context/repositoryStore';

const STAGE_LABEL: Record<AnalysisStage, string> = { downloading: 'Downloading', extracting: 'Extracting', analyzing: 'Analyzing', saving: 'Saving' };
const MODE_TEXT: Record<Mode, string> = {
  beginner: 'Follow a guided path to understand this codebase, one step at a time.',
  contributor: 'Find meaningful, well-scoped places to contribute to this codebase.',
};

type View =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'no-repositories' }
  | { kind: 'analyzing'; message: string }
  | { kind: 'no-map'; title: string; message: string }
  | { kind: 'error'; message: string };

interface Loaded {
  data: AtlasData;
  /** null = findings unavailable (not loaded, or from a different analysis than the map) */
  issues: IArchitecturalIssue[] | null;
  repo: PathRepo;
}

/** Dev-only: ?sample=1 loads the bundled real analysis of this project (no server needed), like the Dependency Atlas. */
async function devSample(): Promise<AtlasData | null> {
  if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has('sample')) return null;
  const { default: url } = await import('../features/atlas/sample/atlas-sample.json?url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the sample analysis (${res.status}).`);
  return parseAtlasData(await res.json());
}

export default function OnboardingPathfinder() {
  const repositories = useRepositoryStore((s) => s.repositories);
  const selectedRepo = useRepositoryStore((s) => s.selectedRepo);
  const mode = usePathfinderStore((s) => s.mode);
  const beginnerPath = usePathfinderStore((s) => s.beginnerPath);
  const current = usePathfinderStore((s) => s.current);
  const sync = usePathfinderStore((s) => s.sync);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [devMode, setDevMode] = useState(false);
  const store = usePathfinderStore.getState;

  const repo: RepositorySummary | null = selectedRepo ?? repositories[0] ?? null;
  const repoId = repo?._id ?? null;

  // ---- data: repositories -> Dependency Atlas + findings + saved progress -------------------------
  useEffect(() => {
    const ctrl = new AbortController();
    let timer = 0;
    setView({ kind: 'loading' });
    setLoaded(null);
    setNotice(null);

    const load = async (target: RepositorySummary) => {
      store().reset(target._id);
      if (target.analysisStatus === 'analyzing' || target.analysisStatus === 'pending') {
        const st = await api.getRepositoryStatus(target._id).catch(() => null);
        if (ctrl.signal.aborted) return;
        if (st && (st.status === 'analyzing' || st.status === 'pending')) {
          setView({ kind: 'analyzing', message: st.stage ? `${STAGE_LABEL[st.stage]}… ${st.message ?? ''}` : st.message || 'Analysis in progress…' });
          timer = window.setTimeout(() => { if (!ctrl.signal.aborted) void load({ ...target, analysisStatus: st.status }); }, 2500);
          return;
        }
      }
      const [atlas, details] = await Promise.all([
        fetchAtlas(target._id, ctrl.signal),
        api.getRepositoryDetails(target._id).catch(() => null),
      ]);
      if (ctrl.signal.aborted) return;
      if (!atlas.ok) {
        if (atlas.code === 'NO_ANALYSIS') setView({ kind: 'no-map', title: 'No completed analysis yet', message: target.analysisStatus === 'failed' ? `The analysis failed: ${target.statusMessage || 'unknown error'}.` : 'Analyze this repository first. The learning path and contribution opportunities are built from the analysis.' });
        else if (atlas.code === 'NO_ATLAS') setView({ kind: 'no-map', title: 'This analysis has no dependency data', message: 'The Onboarding Pathfinder needs the dependency data that newer analyses store. Re-analyze the repository from the Dependency Atlas or the Home page.' });
        else if (atlas.code === 'TOO_LARGE') setView({ kind: 'no-map', title: 'Repository too large', message: atlas.message });
        else setView({ kind: 'error', message: atlas.message });
        return;
      }
      const a = details?.latestAnalysis ?? null;
      const sameAnalysis = !!a && (a.commitSha ?? '') === (atlas.data.repo.commitSha ?? '');
      const issues = sameAnalysis ? a!.issues ?? [] : null;
      if (!details) setNotice('Architectural findings could not be loaded, so opportunities based on them are missing.');
      else if (a && !sameAnalysis) setNotice('Architectural findings belong to a different analysis than the dependency data, so they are not used. Re-analyze to bring both in line.');
      else if (target.analysisStatus === 'failed') setNotice(`The latest analysis failed (${target.statusMessage || 'no message'}). This page shows the previous successful analysis.`);
      setLoaded({ data: atlas.data, issues, repo: { _id: target._id, owner: target.owner, name: target.name, source: target.source, commitSha: atlas.data.repo.commitSha } });
      setView({ kind: 'ready' });
      void store().loadProgress();
    };

    (async () => {
      try {
        const sample = await devSample();
        if (ctrl.signal.aborted) return;
        if (sample) {
          setDevMode(true);
          store().reset(null);
          setNotice(`Sample analysis (dev only): ${sample.repo.owner}/${sample.repo.name}. Progress is not saved and findings are not loaded.`);
          setLoaded({ data: sample, issues: null, repo: { _id: 'sample', owner: sample.repo.owner, name: sample.repo.name, source: 'github', commitSha: sample.repo.commitSha } });
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
        await load(target);
      } catch (err) {
        if (!ctrl.signal.aborted) setView({ kind: 'error', message: err instanceof Error ? err.message : 'The analysis could not be loaded.' });
      }
    })();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [repoId, reload]);

  // ---- derived data ---------------------------------------------------------------------------
  const facts = useMemo(() => (loaded ? buildRepoFacts(loaded.data) : null), [loaded]);
  const steps = useMemo(() => (facts ? buildLearningPath(facts) : []), [facts]);
  const opportunities = useMemo(() => (facts && loaded ? deriveOpportunities(facts, loaded.issues) : { list: [], limits: [] }), [facts, loaded]);

  // open the saved current step, or the first unfinished one, once the data and the saved progress are in
  const progressSettled = sync !== 'loading' && sync !== 'idle';
  useEffect(() => {
    if (!facts || !progressSettled || beginnerPath) return;
    const s = store();
    const start = (current && facts.file(current) ? current : null) ?? steps.find((x) => !s.completed.has(x.path))?.path ?? steps[0]?.path;
    if (start) s.openFile(start);
  }, [facts, steps, progressSettled, beginnerPath, current]);
  useEffect(() => {
    if (opportunities.list.length && !store().oppId) store().selectOpp(opportunities.list[0].id);
  }, [opportunities]);

  const learnFile = (path: string, line?: number) => {
    store().openFile(path, line ? { line, tab: 'code' } : undefined);
    store().setMode('beginner');
  };
  const onSearch = (p: SearchPick) => {
    if (!facts) return;
    let path = p.path;
    if (p.kind === 'folder') {
      const inFolder = facts.data.files.filter((f) => f.path.startsWith(`${p.path}/`));
      const central = [...inFolder].sort((a, b) => facts.fanIn(b.path) - facts.fanIn(a.path) || a.path.length - b.path.length)[0];
      if (!central) return;
      path = central.path;
    }
    if (mode === 'contributor') {
      const opp = opportunities.list.find((o) => o.files.some((f) => f.exists && f.path === path));
      if (opp) { store().setFilters({ type: 'all', effort: 'all', area: 'all', savedOnly: false }); store().selectOpp(opp.id); return; }
    }
    learnFile(path, p.line);
  };
  const describeResult = (r: SearchResult) => {
    if (!facts) return '';
    let path = r.path;
    if (r.kind === 'folder') {
      const inFolder = facts.data.files.filter((f) => f.path.startsWith(`${r.path}/`));
      const central = [...inFolder].sort((a, b) => facts.fanIn(b.path) - facts.fanIn(a.path) || a.path.length - b.path.length)[0];
      if (!central) return 'Empty folder';
      path = central.path;
    }
    if (mode === 'contributor') {
      const opp = opportunities.list.find((o) => o.files.some((f) => f.exists && f.path === path));
      if (opp) return `Shows the opportunity “${opp.title}”`;
    }
    const i = steps.findIndex((s) => s.path === path);
    if (r.kind === 'folder') return `Opens ${facts.name(path)}, the most imported file in this folder`;
    return i >= 0 ? `Step ${i + 1} of the learning path` : r.line ? `Opens the code at line ${r.line}` : 'Opens the file in the learning view';
  };

  const ready = view.kind === 'ready' && !!loaded && !!facts;

  return (
    <div className="pf-page">
      <header className="pf-header">
        <div style={{ minWidth: 0 }}>
          <nav className="pf-crumb" aria-label="Breadcrumb">
            <Link to="/home" aria-label="Back to Home"><ChevronLeft size={14} /></Link>
            <span>/</span><span aria-current="page">Onboarding Pathfinder</span>
          </nav>
          <h1 className="page-title">Onboarding Pathfinder</h1>
          <p className="page-sub pf-sub">{MODE_TEXT[mode]}</p>
        </div>
        <div className="pf-header-actions">
          {!devMode && repositories.length > 0 && (
            <select
              className="pf-select pf-repo-select"
              value={repoId ?? ''}
              onChange={(e) => useRepositoryStore.getState().setSelectedRepo(repositories.find((r) => r._id === e.target.value) ?? null)}
              aria-label="Repository"
            >
              {repositories.map((r) => <option key={r._id} value={r._id}>{r.fullName}</option>)}
            </select>
          )}
          <PathSearch facts={ready ? facts : null} onPick={onSearch} describe={describeResult} />
        </div>
      </header>

      <div className={`pf-top${mode === 'beginner' && ready ? ' has-progress' : ''}`}>
        <div className="pf-modes" role="group" aria-label="Mode">
          <button type="button" className={`pf-mode${mode === 'beginner' ? ' is-active' : ''}`} aria-pressed={mode === 'beginner'} onClick={() => store().setMode('beginner')}>
            <Sprout size={26} aria-hidden="true" />
            <span><strong>Beginner Path</strong><span>Learn and understand the codebase</span></span>
          </button>
          <button type="button" className={`pf-mode${mode === 'contributor' ? ' is-active' : ''}`} aria-pressed={mode === 'contributor'} onClick={() => store().setMode('contributor')}>
            <Users size={26} aria-hidden="true" />
            <span><strong>Contributor Path</strong><span>Find meaningful places to contribute</span></span>
          </button>
        </div>
        {mode === 'beginner' && ready && <ProgressPanel steps={steps} />}
      </div>

      {notice && ready && <p className="pf-notice" role="note">{notice}</p>}

      {view.kind === 'loading' && <State icon={<RefreshCw size={22} className="spin" style={{ color: '#8B78FF' }} />} title="Loading the repository analysis…" status />}
      {view.kind === 'analyzing' && <State icon={<RefreshCw size={22} className="spin" style={{ color: '#8B78FF' }} />} title="Analysis in progress" text={view.message} status />}
      {view.kind === 'no-repositories' && (
        <State icon={<Compass size={26} color="#8B78FF" />} title="No repository yet" text="Analyze a repository on the Home page, then come back for a guided path through it.">
          <Link to="/home" className="pf-btn" style={{ marginTop: 14 }}>Go to Home</Link>
        </State>
      )}
      {view.kind === 'no-map' && (
        <State icon={<Compass size={26} color="#8B78FF" />} title={view.title} text={view.message}>
          <div className="pf-row" style={{ marginTop: 14, justifyContent: 'center' }}>
            <Link to="/atlas" className="pf-btn">Open the Dependency Atlas</Link>
            <Link to="/home" className="pf-btn">Go to Home</Link>
          </div>
        </State>
      )}
      {view.kind === 'error' && (
        <State icon={<AlertCircle size={26} color="#FF717A" />} title="The analysis could not be loaded" text={view.message} alert>
          <button type="button" className="pf-btn" style={{ marginTop: 14 }} onClick={() => setReload((n) => n + 1)}><RefreshCw size={13} /> Try again</button>
        </State>
      )}

      {ready && loaded.data.files.length === 0 && <State icon={<Compass size={26} color="#8B78FF" />} title="This repository has no analysed files" />}
      {ready && loaded.data.files.length > 0 && (
        mode === 'beginner'
          ? <BeginnerPath facts={facts} steps={steps} repo={loaded.repo} onExploreContributing={() => store().setMode('contributor')} />
          : <ContributorPath facts={facts} result={opportunities} repo={loaded.repo} onLearnFile={learnFile} />
      )}
    </div>
  );
}

function State({ icon, title, text, children, status, alert }: { icon: ReactNode; title: string; text?: string; children?: ReactNode; status?: boolean; alert?: boolean }) {
  return (
    <section className="pf-state card" role={alert ? 'alert' : status ? 'status' : undefined}>
      <div>{icon}<h2>{title}</h2>{text && <p>{text}</p>}{children}</div>
    </section>
  );
}
