import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalysisSummary, AnalyzeResult, ApiError, RepositoryStatus, RepositorySummary, api } from '../lib/api';
import { formatNumber, isAvailable, parseGitHubUrl, sanitizeProjectName, shortSha } from '../lib/analysisFormat';
import { useRepositoryStore } from '../context/repositoryStore';
import ImportPanel, { AnalysisProgress, ImportNotice, ImportPrefill } from '../components/home/ImportPanel';
import RecentRepositories from '../components/home/RecentRepositories';
import RepositoryOverview from '../components/home/RepositoryOverview';
import DependencyOverview from '../components/home/DependencyOverview';
import ArchitecturalHealth from '../components/home/ArchitecturalHealth';
import LanguageSupport from '../components/home/LanguageSupport';
import ExploreCards from '../components/home/ExploreCards';
import { Badge } from '../components/home/ui';

/** How often to poll /:id/status while this page is running an analysis. */
const POLL_INTERVAL_MS = 2000;
/** How often to poll a selected repository that is being analyzed elsewhere (another tab, or a 409). */
const WATCH_INTERVAL_MS = 3000;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function hintForStatus(status: number): string | undefined {
  switch (status) {
    case 409:
      return 'Another analysis of this repository is already running. Its progress is shown in the overview below.';
    case 429:
      return 'You are being rate limited. Wait a minute before starting another analysis.';
    case 413:
      return 'Reduce the archive size (for example remove node_modules, build output or media files) and try again.';
    case 503:
      return 'The analysis service is busy or temporarily down. Try again shortly.';
    case 0:
      return 'Check that the server is running and reachable.';
    default:
      return undefined;
  }
}

interface RunOptions {
  label: string;
  /** Identifies the repository being analyzed, so progress can be polled before the POST returns. */
  matches: (repo: RepositorySummary) => boolean;
  knownId?: string;
  start: () => Promise<AnalyzeResult>;
}

export default function Home() {
  const { repositories, selectedRepo, details, searchQuery, setRepositories, setSelectedRepo, setDetails } = useRepositoryStore();

  const [isLoadingRepos, setIsLoadingRepos] = useState(repositories.length === 0);
  const [reposError, setReposError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsReloadKey, setDetailsReloadKey] = useState(0);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [notice, setNotice] = useState<ImportNotice | null>(null);
  const [prefill, setPrefill] = useState<ImportPrefill | null>(null);
  const [watchStatus, setWatchStatus] = useState<RepositoryStatus | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const loadRepositories = useCallback(
    async (selectId?: string): Promise<RepositorySummary[] | null> => {
      try {
        const repos = await api.getRepositories();
        setRepositories(repos);
        setReposError(null);
        if (selectId) {
          const match = repos.find((r) => r._id === selectId);
          if (match) setSelectedRepo(match);
        }
        return repos;
      } catch (err) {
        setReposError(errorMessage(err, 'Failed to load repositories.'));
        return null;
      } finally {
        setIsLoadingRepos(false);
      }
    },
    [setRepositories, setSelectedRepo]
  );

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  // Full details (issues, coverage, history) for the selected repository
  const selectedId = selectedRepo?._id ?? null;
  const selectedVersion = [selectedRepo?.analysisStatus, selectedRepo?.lastAnalyzedAt, selectedRepo?.latestAnalysis?._id].join('|');
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);
    api
      .getRepositoryDetails(selectedId)
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch((err) => {
        if (!cancelled) setDetailsError(errorMessage(err, 'Failed to load repository details.'));
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedVersion, detailsReloadKey, setDetails]);

  // Selected repository is being analyzed by someone else: follow its real status until it settles
  const watchId = selectedRepo?.analysisStatus === 'analyzing' && !progress ? selectedRepo._id : null;
  useEffect(() => {
    setWatchStatus(null);
    if (!watchId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const status = await api.getRepositoryStatus(watchId);
        if (cancelled) return;
        setWatchStatus(status);
        if (status.status !== 'analyzing') {
          cancelled = true;
          void loadRepositories();
        }
      } catch {
        // Transient polling failure; the next tick retries
      }
    };
    void tick();
    const timer = window.setInterval(tick, WATCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watchId, loadRepositories]);

  const runAnalysis = async ({ label, matches, knownId, start }: RunOptions): Promise<boolean> => {
    if (progress) return false;
    setNotice(null);
    setProgress({ label, stage: null, message: 'Sending request to the analysis server…' });

    let repoId = knownId ?? null;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        if (!repoId) {
          const list = await api.getRepositories();
          repoId = list.find((r) => matches(r) && r.analysisStatus === 'analyzing')?._id ?? null;
        }
        if (repoId) {
          const status = await api.getRepositoryStatus(repoId);
          // Ignore the previous run's final status until the server marks this run as started
          if (status.status === 'analyzing') {
            setProgress((p) => p && { ...p, stage: status.stage ?? null, message: status.message || p.message });
          }
        }
      } catch {
        // Polling is best-effort; the POST response is authoritative
      } finally {
        polling = false;
      }
    };
    stopPolling();
    pollTimerRef.current = window.setInterval(poll, POLL_INTERVAL_MS);

    try {
      const result = await start();
      const repo = result.repository;
      const sha = shortSha(result.analysis?.commitSha ?? repo.commitSha);
      if (result.reused) {
        setNotice({
          tone: 'blue',
          title: 'No changes since last analysis',
          detail: `${repo.fullName}${sha ? ` at commit ${sha}` : ''} was already analyzed, so the existing result is shown. Use “Re-analyze” or “Force re-analysis” to run it again.`,
        });
      } else {
        const m = result.analysis?.metrics;
        const parts = m
          ? [
              `${formatNumber(m.totalFiles)} files`,
              isAvailable(m.totalLines) ? `${formatNumber(m.totalLines)} lines` : null,
              isAvailable(m.functions) ? `${formatNumber(m.functions)} functions` : 'functions N/A',
            ].filter(Boolean)
          : [];
        setNotice({
          tone: 'green',
          title: `Analyzed ${repo.fullName}`,
          detail: parts.length ? `${parts.join(' · ')}${sha ? ` (commit ${sha})` : ''}.` : undefined,
        });
      }
      await loadRepositories(repo._id);
      setDetailsReloadKey((k) => k + 1);
      return true;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setNotice({ tone: 'red', title: errorMessage(err, 'Analysis failed.'), detail: hintForStatus(status) });
      // Surface the affected repository: still analyzing (409) or now failed with previous results
      const list = await loadRepositories();
      const affected = list?.find((r) => (repoId ? r._id === repoId : matches(r)));
      if (affected) setSelectedRepo(affected);
      return false;
    } finally {
      stopPolling();
      setProgress(null);
    }
  };

  const handleAnalyzeGitHub = (url: string, force: boolean) => {
    const parsed = parseGitHubUrl(url);
    if (!parsed) return Promise.resolve(false);
    const fullName = `${parsed.owner}/${parsed.repo}`.toLowerCase();
    const matches = (r: RepositorySummary) => r.source === 'github' && r.fullName.toLowerCase() === fullName;
    return runAnalysis({
      label: `${parsed.owner}/${parsed.repo}${parsed.branch ? ` (${parsed.branch})` : ''}`,
      matches,
      knownId: repositories.find(matches)?._id,
      start: () => api.analyzeGitHub(url, force),
    });
  };

  const handleAnalyzeZip = (file: File, projectName: string, force: boolean) => {
    const name = sanitizeProjectName(projectName || file.name.replace(/\.zip$/i, ''));
    const matches = (r: RepositorySummary) => r.source === 'zip' && r.name.toLowerCase() === name.toLowerCase();
    return runAnalysis({
      label: `${name}.zip`,
      matches,
      knownId: repositories.find(matches)?._id,
      start: () => api.analyzeZip(file, projectName || undefined, force),
    });
  };

  const handleReanalyze = (repo: RepositorySummary) => {
    if (repo.source === 'github') {
      const url = repo.githubUrl || `https://github.com/${repo.owner}/${repo.name}`;
      void runAnalysis({
        label: repo.fullName,
        matches: (r) => r._id === repo._id,
        knownId: repo._id,
        start: () => api.analyzeGitHub(url, true),
      });
      return;
    }
    // A ZIP can only be re-analyzed by uploading it again
    setPrefill({ tab: 'zip', value: repo.name, force: true, nonce: Date.now() });
    setNotice({
      tone: 'blue',
      title: `Re-upload the archive for ${repo.name}`,
      detail: 'ZIP repositories are re-analyzed by uploading the archive again. “Force re-analysis” is pre-selected.',
    });
    document.getElementById('import-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSelect = (repo: RepositorySummary) => {
    setSelectedRepo(repo);
    document.getElementById('repo-overview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Filter repositories based on topbar search query
  const query = searchQuery.trim().toLowerCase();
  const filteredRepositories = query
    ? repositories.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          r.owner.toLowerCase().includes(query) ||
          r.fullName.toLowerCase().includes(query) ||
          (r.primaryLanguage || '').toLowerCase().includes(query)
      )
    : repositories;

  const activeDetails = details && details.repository?._id === selectedId ? details : null;
  const analysis: AnalysisSummary | null = activeDetails?.latestAnalysis ?? selectedRepo?.latestAnalysis ?? null;
  const live = watchStatus ? { stage: watchStatus.stage, message: watchStatus.message } : null;

  return (
    <div className="home-dashboard" style={{ paddingTop: 10, maxWidth: 1280, margin: '0 auto', minWidth: 0 }}>
      {/* 1. Welcome Header Section */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 28 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '3px',
              fontWeight: 600,
              color: '#8B78FF',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            WELCOME BACK
          </div>
          <h1
            style={{
              fontSize: 'clamp(28px, 3.2vw, 40px)',
              fontWeight: 700,
              lineHeight: 1.15,
              color: '#F3F6FF',
              margin: '0 0 10px',
              letterSpacing: '-0.02em',
            }}
          >
            Map Any Codebase.<br />
            Discover Its Universe.
          </h1>
          <div style={{ fontSize: 13, color: '#A7B4CC', letterSpacing: '0.2px' }}>Visualize. Understand. Explore. Contribute.</div>
        </div>

        <div className="home-hero-quote" style={{ textAlign: 'right', maxWidth: 260, paddingTop: 12 }}>
          <div style={{ width: 32, height: 1, background: 'rgba(135, 155, 255, 0.4)', marginLeft: 'auto', marginBottom: 10 }} />
          <div style={{ fontStyle: 'italic', fontSize: 13, color: '#B8BBCB', lineHeight: 1.5 }}>
            &ldquo;From scattered files<br />
            to a <span style={{ color: '#EAF0FF', fontWeight: 500 }}>connected universe</span>.&rdquo;
          </div>
        </div>
      </div>

      {/* 2. Repository Import Panel */}
      <ImportPanel
        progress={progress}
        notice={notice}
        prefill={prefill}
        onDismissNotice={() => setNotice(null)}
        onAnalyzeGitHub={handleAnalyzeGitHub}
        onAnalyzeZip={handleAnalyzeZip}
      />

      {/* 3. Recent Repositories & Repository Overview */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          gap: 24,
          marginBottom: 36,
        }}
      >
        <RecentRepositories
          repositories={filteredRepositories}
          totalCount={repositories.length}
          searchQuery={searchQuery}
          isLoading={isLoadingRepos}
          error={reposError}
          selectedId={selectedId}
          onRetry={() => {
            setIsLoadingRepos(true);
            void loadRepositories();
          }}
          onSelect={handleSelect}
        />
        <RepositoryOverview
          repo={selectedRepo}
          analysis={analysis}
          history={
            activeDetails
              ? {
                  total: activeDetails.analysisHistory.length,
                  failed: activeDetails.analysisHistory.filter((h) => h.status === 'failed').length,
                }
              : null
          }
          live={live}
          busy={progress !== null}
          onReanalyze={handleReanalyze}
        />
      </div>

      {/* 4. Analysis details for the selected repository */}
      {selectedRepo && analysis && (
        <section aria-label="Analysis details" style={{ marginBottom: 36 }}>
          <h3
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              fontSize: 16,
              fontWeight: 600,
              color: '#F3F6FF',
              margin: '0 0 16px',
              letterSpacing: '-0.01em',
            }}
          >
            Analysis Details
            <span style={{ fontWeight: 400, fontSize: 13, color: '#77839C', overflowWrap: 'anywhere' }}>· {selectedRepo.fullName}</span>
            {selectedRepo.analysisStatus === 'failed' && (
              <Badge tone="red" title="The most recent run failed; these are the last successful results.">
                Previous results
              </Badge>
            )}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 24 }}>
            <DependencyOverview analysis={analysis} />
            <LanguageSupport analysis={analysis} />
            <ArchitecturalHealth
              analysis={activeDetails?.latestAnalysis ?? null}
              isLoading={detailsLoading}
              error={detailsError}
              onRetry={() => setDetailsReloadKey((k) => k + 1)}
            />
          </div>
        </section>
      )}

      {/* 5. Explore the Universe */}
      <ExploreCards />
    </div>
  );
}
