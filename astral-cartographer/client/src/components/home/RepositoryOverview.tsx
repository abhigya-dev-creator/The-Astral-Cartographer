import React from 'react';
import { AlertTriangle, Code2, FileArchive, Folder, GitCommitHorizontal, Layers, Network, RotateCw } from 'lucide-react';
import { AnalysisStage, AnalysisSummary, RepositorySummary } from '../../lib/api';
import {
  definitionFor,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  getLanguageColor,
  isAvailable,
  revisionLabel,
  shortSha,
} from '../../lib/analysisFormat';
import { RepositoryStatusBadge } from './RecentRepositories';
import { Badge, EmptyState, GithubIcon, InfoTip, MetricValue, Notice, Panel, Spinner, StageProgress, monoStyle } from './ui';

// Same tile colors as the original overview cards
const TILE_COLORS = {
  blue: { fg: '#6898FF', rgb: '56, 107, 255', bg: 0.1, icon: 0.25 },
  cyan: { fg: '#37D9FF', rgb: '55, 217, 255', bg: 0.08, icon: 0.2 },
  orange: { fg: '#FFAD66', rgb: '255, 173, 102', bg: 0.08, icon: 0.2 },
  red: { fg: '#FF717A', rgb: '255, 113, 122', bg: 0.08, icon: 0.2 },
};

function MetricTile({
  tone,
  icon,
  value,
  label,
  tip,
  sub,
}: {
  tone: keyof typeof TILE_COLORS;
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  tip?: string;
  sub?: React.ReactNode;
}) {
  const t = TILE_COLORS[tone];
  return (
    <div
      style={{
        background: `rgba(${t.rgb}, ${t.bg})`,
        border: `1px solid rgba(${t.rgb}, 0.35)`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: `rgba(${t.rgb}, ${t.icon})`,
          display: 'grid',
          placeItems: 'center',
          color: t.fg,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF' }}>{value}</div>
        <div style={{ fontSize: 11, color: '#8898B0', display: 'flex', alignItems: 'center', gap: 4 }}>
          {label} <InfoTip text={tip} />
        </div>
        {sub && <div style={{ fontSize: 11, color: '#77839C', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function functionKindsTooltip(analysis: AnalysisSummary): string | undefined {
  const k = analysis.metrics.functionKinds;
  const base = definitionFor(analysis.metrics, 'functions');
  if (!k) return base;
  return `${base ?? ''}\nDeclarations ${k.declarations} · Expressions ${k.expressions} · Arrows ${k.arrows} · Methods ${k.methods} · Constructors ${k.constructors} · Object methods ${k.objectMethods}`.trim();
}

interface RepositoryOverviewProps {
  repo: RepositorySummary | null;
  analysis: AnalysisSummary | null;
  history: { total: number; failed: number } | null;
  live: { stage: AnalysisStage | null | undefined; message?: string | null } | null;
  busy: boolean;
  onReanalyze: (repo: RepositorySummary) => void;
}

export default function RepositoryOverview({ repo, analysis, history, live, busy, onReanalyze }: RepositoryOverviewProps) {
  const isFailed = repo?.analysisStatus === 'failed';
  const isAnalyzing = repo?.analysisStatus === 'analyzing';

  const pill = !repo ? undefined : isFailed && analysis ? (
    <Badge tone="red" title="The most recent run failed; these are the last successful results.">Previous Results</Badge>
  ) : analysis ? (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: '#6898FF',
        background: 'rgba(56, 107, 255, 0.15)',
        border: '1px solid rgba(100, 160, 255, 0.35)',
        padding: '3px 10px',
        borderRadius: 999,
      }}
    >
      Latest Analysis
    </span>
  ) : undefined;

  if (!repo) {
    return (
      <Panel id="repo-overview" title="Repository Overview">
        <EmptyState icon={<Layers size={28} color="#6898FF" />} title="No Repository Selected">
          Select a repository from the list or analyze a new codebase to inspect metrics here.
        </EmptyState>
      </Panel>
    );
  }

  const m = analysis?.metrics;
  const support = m?.supportStatus;
  const commitSha = analysis?.commitSha ?? repo.commitSha ?? null;
  const branch = analysis?.branch ?? repo.defaultBranch;
  const language = repo.primaryLanguage || 'Unknown';
  const coverage = m?.coverage;
  const coverageWarnings = Array.from(new Set([...(coverage?.warnings ?? []), ...(analysis?.warnings ?? [])]));
  const showCoverageBanner = coverage?.completeness === 'partial' || analysis?.truncated === true;

  return (
    <Panel id="repo-overview" title="Repository Overview" action={pill}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 14,
          paddingBottom: 14,
          borderBottom: '1px solid rgba(135, 155, 255, 0.12)',
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'rgba(56, 107, 255, 0.15)',
            border: '1px solid rgba(135, 155, 255, 0.35)',
            display: 'grid',
            placeItems: 'center',
            color: '#EAF0FF',
            flexShrink: 0,
          }}
        >
          {repo.source === 'github' ? <GithubIcon size={20} /> : <FileArchive size={18} />}
        </div>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F3F6FF', overflowWrap: 'anywhere' }}>
            <span style={{ fontWeight: 400, color: '#A7B4CC' }}>{repo.owner} / </span>
            {repo.name}
          </div>
          <div style={{ fontSize: 12, color: '#A7B4CC' }}>
            {repo.description || 'Software repository analyzed by The Astral Cartographer.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onReanalyze(repo)}
          disabled={busy || isAnalyzing}
          title={
            repo.source === 'github'
              ? 'Run a fresh analysis even if this commit was analyzed before'
              : 'Upload the archive again and force a fresh analysis'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 32,
            padding: '0 12px',
            borderRadius: 8,
            fontSize: 12,
            color: '#EAF0FF',
            background: 'rgba(56, 107, 255, 0.15)',
            border: '1px solid rgba(100, 160, 255, 0.4)',
            cursor: busy || isAnalyzing ? 'not-allowed' : 'pointer',
            opacity: busy || isAnalyzing ? 0.55 : 1,
            flexShrink: 0,
          }}
        >
          <RotateCw size={13} /> {repo.source === 'github' ? 'Re-analyze' : 'Re-upload ZIP'}
        </button>
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12, color: '#A7B4CC', marginBottom: 14 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: language === 'Unknown' ? '#77839C' : undefined }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: getLanguageColor(language) }} />
          {language}
        </span>
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title={commitSha ? `${revisionLabel(repo.source)}: ${commitSha}` : `No ${revisionLabel(repo.source).toLowerCase()} recorded for this analysis`}
        >
          <GitCommitHorizontal size={13} color="#77839C" />
          {repo.source === 'zip' && <span style={{ color: '#77839C' }}>Archive</span>}
          {commitSha ? (
            <span style={{ ...monoStyle, color: '#A99AFF' }}>{shortSha(commitSha)}</span>
          ) : (
            <span style={{ color: '#77839C' }}>No {revisionLabel(repo.source).toLowerCase()}</span>
          )}
          {repo.source === 'github' && branch && <span style={{ color: '#77839C' }}>on {branch}</span>}
        </span>
        <span title={formatDateTime(repo.lastAnalyzedAt)}>Analyzed {formatRelativeTime(repo.lastAnalyzedAt)}</span>
        {history && history.total > 0 && (
          <span style={{ color: '#77839C' }}>
            {history.total} run{history.total === 1 ? '' : 's'} in history
            {history.failed > 0 && ` (${history.failed} failed)`}
          </span>
        )}
        {analysis?.analyzerVersion && <span style={{ color: '#77839C' }}>Analyzer v{analysis.analyzerVersion}</span>}
        {repo.analysisStatus !== 'completed' && <RepositoryStatusBadge repo={repo} />}
      </div>

      {/* Status notices */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {isAnalyzing && <StageProgress stage={live?.stage} message={live?.message ?? repo.statusMessage} />}
        {isFailed && (
          <Notice tone="red" title="The latest analysis failed">
            {repo.statusMessage || 'No error message was recorded.'}
            {analysis
              ? ` Showing the previous successful results${analysis.createdAt ? ` from ${formatDateTime(analysis.createdAt)}` : ''}.`
              : ' No previous results are available.'}
          </Notice>
        )}
        {repo.analysisStatus === 'pending' && !analysis && (
          <Notice tone="blue" title="Queued for analysis">
            {repo.statusMessage || 'Results will appear here once the analysis finishes.'}
          </Notice>
        )}
        {showCoverageBanner && (
          <Notice tone="amber" title="Partial coverage: some files were not fully analyzed">
            {coverageWarnings.length > 0 ? (
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {coverageWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              'The analyzer did not report details. Counts below may be lower than the real values.'
            )}
          </Notice>
        )}
        {!showCoverageBanner && coverageWarnings.length > 0 && (
          <Notice tone="blue" title="Analyzer notes">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {coverageWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>

      {/* Metric tiles */}
      {!m ? (
        !isAnalyzing && (
          <EmptyState icon={<Layers size={26} color="#6898FF" />} title="No results yet">
            {isFailed ? 'Fix the problem above and re-analyze to see metrics.' : 'Metrics will appear once an analysis completes.'}
          </EmptyState>
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 14 }}>
          <MetricTile
            tone="blue"
            icon={<Folder size={18} />}
            value={formatNumber(m.totalFiles)}
            label="Total Files"
            tip={definitionFor(m, 'totalFiles')}
            sub={isAvailable(m.totalLines) ? `${formatNumber(m.totalLines)} lines` : 'Lines: N/A'}
          />
          <MetricTile
            tone="cyan"
            icon={<Code2 size={18} />}
            value={<MetricValue value={m.functions} status={support?.functionsStatus} support={support} />}
            label="Functions"
            tip={analysis ? functionKindsTooltip(analysis) : undefined}
          />
          <MetricTile
            tone="orange"
            icon={<Network size={18} />}
            value={<MetricValue value={m.dependencies} status={support?.dependenciesStatus} support={support} />}
            label="Dependency Links"
            tip={definitionFor(m, 'dependencies')}
            sub={
              m.dependencyMetrics
                ? `${formatNumber(m.dependencyMetrics.externalPackages)} external packages · ${formatNumber(m.dependencyMetrics.localDependencies)} local files`
                : undefined
            }
          />
          <MetricTile
            tone="red"
            icon={<AlertTriangle size={18} />}
            value={formatNumber(m.architecturalIssues)}
            label="Architectural Issues"
            tip={definitionFor(m, 'architecturalIssues')}
            sub={
              isAvailable(m.confirmedIssues) || isAvailable(m.heuristicIssues)
                ? `${isAvailable(m.confirmedIssues) ? formatNumber(m.confirmedIssues) : 'N/A'} confirmed · ${
                    isAvailable(m.heuristicIssues) ? formatNumber(m.heuristicIssues) : 'N/A'
                  } heuristic`
                : undefined
            }
          />
        </div>
      )}

      {isAnalyzing && !m && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#77839C' }}>
          <Spinner /> Results will appear when the analysis completes.
        </div>
      )}
    </Panel>
  );
}
