import { useState } from 'react';
import { ArrowRight, Compass, FileArchive, Search } from 'lucide-react';
import { RepositorySummary } from '../../lib/api';
import { formatDateTime, formatNumber, formatRelativeTime, getLanguageColor, revisionLabel, shortSha } from '../../lib/analysisFormat';
import { Badge, EmptyState, GithubIcon, Notice, Panel, Spinner, monoStyle } from './ui';

const COLLAPSED_COUNT = 6;

export function RepositoryStatusBadge({ repo }: { repo: RepositorySummary }) {
  switch (repo.analysisStatus) {
    case 'analyzing':
      return (
        <Badge tone="violet" title={repo.statusMessage || 'Analysis in progress'}>
          <Spinner size={10} /> Analyzing
        </Badge>
      );
    case 'pending':
      return <Badge tone="muted" title={repo.statusMessage || 'Queued for analysis'}>Pending</Badge>;
    case 'failed':
      return (
        <Badge tone="red" title={repo.statusMessage || 'The last analysis failed'}>
          {repo.latestAnalysis ? 'Failed · showing previous results' : 'Failed'}
        </Badge>
      );
    default:
      return null;
  }
}

interface RecentRepositoriesProps {
  repositories: RepositorySummary[];
  totalCount: number;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  selectedId: string | null;
  onRetry: () => void;
  onSelect: (repo: RepositorySummary) => void;
}

export default function RecentRepositories({
  repositories,
  totalCount,
  searchQuery,
  isLoading,
  error,
  selectedId,
  onRetry,
  onSelect,
}: RecentRepositoriesProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? repositories : repositories.slice(0, COLLAPSED_COUNT);
  const canExpand = repositories.length > COLLAPSED_COUNT;

  return (
    <Panel
      title="Recent Repositories"
      action={
        canExpand ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6898FF',
              fontSize: 12,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {showAll ? 'Show less' : `View All (${repositories.length})`} <ArrowRight size={12} />
          </button>
        ) : undefined
      }
    >
      {error && (
        <Notice tone="red" title="Could not load repositories" style={{ marginBottom: 12 }}>
          {error}{' '}
          <button type="button" className="auth-link" onClick={onRetry}>
            Retry
          </button>
        </Notice>
      )}

      {isLoading ? (
        <div style={{ padding: '36px 0', textAlign: 'center', color: '#77839C', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <Spinner size={20} />
          </div>
          Querying repository atlas...
        </div>
      ) : totalCount === 0 ? (
        !error && (
          <EmptyState icon={<Compass size={28} color="#8B78FF" />} title="No Repositories Mapped Yet">
            Enter a GitHub URL or upload a ZIP file above to analyze files, functions, and dependency structures.
          </EmptyState>
        )
      ) : repositories.length === 0 ? (
        <EmptyState icon={<Search size={26} color="#6898FF" />} title="No matching repositories">
          Nothing matches “{searchQuery}”. Clear the search to see all {totalCount} repositories.
        </EmptyState>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map((repo) => {
            const isSelected = selectedId === repo._id;
            const sha = shortSha(repo.commitSha ?? repo.latestAnalysis?.commitSha);
            const language = repo.primaryLanguage || 'Unknown';
            return (
              <li key={repo._id}>
                <button
                  type="button"
                  className={`repo-row${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={`Open ${repo.fullName}`}
                  onClick={() => onSelect(repo)}
                >
                  <span style={{ color: '#B8BBCB', display: 'flex' }}>
                    {repo.source === 'github' ? <GithubIcon /> : <FileArchive size={16} />}
                  </span>

                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#EAF0FF',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {repo.owner} / <strong style={{ fontWeight: 600 }}>{repo.name}</strong>
                    </span>
                    {repo.analysisStatus !== 'completed' && (
                      <span>
                        <RepositoryStatusBadge repo={repo} />
                      </span>
                    )}
                    <span className="repo-row-meta">
                      {language} · {formatNumber(repo.fileCount)} files · {formatRelativeTime(repo.lastAnalyzedAt)}
                    </span>
                  </span>

                  <span className="repo-col" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: language === 'Unknown' ? '#77839C' : '#A7B4CC', minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: getLanguageColor(language) }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{language}</span>
                  </span>

                  <span
                    className="repo-col"
                    title={
                      repo.commitSha ?? repo.latestAnalysis?.commitSha
                        ? `${revisionLabel(repo.source)}: ${repo.commitSha ?? repo.latestAnalysis?.commitSha}`
                        : `No ${revisionLabel(repo.source).toLowerCase()} recorded`
                    }
                    style={{ ...monoStyle, color: sha ? '#A99AFF' : '#77839C' }}
                  >
                    {sha ?? '—'}
                  </span>

                  <span className="repo-col" style={{ fontSize: 12, color: '#8898B0' }}>
                    {formatNumber(repo.fileCount)} files
                  </span>

                  <span className="repo-col" title={formatDateTime(repo.lastAnalyzedAt)} style={{ fontSize: 11, color: '#77839C', textAlign: 'right' }}>
                    {formatRelativeTime(repo.lastAnalyzedAt)}
                  </span>

                  <ArrowRight size={14} color="#77839C" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
