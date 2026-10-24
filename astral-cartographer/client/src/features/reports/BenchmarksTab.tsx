import React, { useState } from 'react';
import { GitCompare, Plus, Info, Check, ShieldCheck, AlertCircle } from 'lucide-react';
import type { BenchmarkRepoData } from './reportsTypes';
import type { RepositorySummary } from '../../lib/api';
import { formatCompactNumber } from './reportsCalculation';

interface BenchmarksTabProps {
  currentRepo: RepositorySummary | null;
  benchmarks: BenchmarkRepoData[];
  availableRepos: RepositorySummary[];
  onSelectCompareRepo?: (repoId: string) => void;
}

export function BenchmarksTab({
  currentRepo,
  benchmarks,
  availableRepos,
  onSelectCompareRepo,
}: BenchmarksTabProps) {
  const [selectedMetricGroup, setSelectedMetricGroup] = useState<'all' | 'code' | 'architecture' | 'community'>('all');

  const metricsDefinitions: Record<string, string> = {
    'Total Files': 'Total discovered files across repository directories.',
    'Lines of Code': 'Total lines of code detected across source files.',
    'Dependencies': 'Total resolved internal and external module dependency graph edges.',
    'Architectural Issues': 'Detected circular dependencies, high coupling hubs, and oversized modules.',
    'Primary Language': 'Dominant programming language by file count and byte footprint.',
    'Stars': 'GitHub community stars (repository hosting metric).',
    'Forks': 'GitHub repository forks count.',
    'Contributors': 'Unique code contributors from repository hosting metadata.',
    'Open Issues': 'Active open issues tracked in repository hosting.',
    'Closed Issues': 'Resolved issues tracked in repository hosting.',
  };

  const metricRows: Array<{
    label: string;
    group: 'code' | 'architecture' | 'community';
    getValue: (b: BenchmarkRepoData) => string;
  }> = [
    {
      label: 'Primary Language',
      group: 'code',
      getValue: (b) => b.primaryLanguage || 'Unknown',
    },
    {
      label: 'Total Files',
      group: 'code',
      getValue: (b) => (b.fileCount !== null ? b.fileCount.toLocaleString() : 'N/A'),
    },
    {
      label: 'Lines of Code',
      group: 'code',
      getValue: (b) => (b.linesOfCode !== null ? formatCompactNumber(b.linesOfCode) : 'N/A'),
    },
    {
      label: 'Dependencies',
      group: 'architecture',
      getValue: (b) => (b.dependencies !== null ? formatCompactNumber(b.dependencies) : 'N/A'),
    },
    {
      label: 'Architectural Issues',
      group: 'architecture',
      getValue: (b) => (b.architecturalIssues !== null ? b.architecturalIssues.toString() : 'N/A'),
    },
    {
      label: 'Stars',
      group: 'community',
      getValue: (b) => (b.stars !== null ? formatCompactNumber(b.stars) : 'N/A'),
    },
    {
      label: 'Forks',
      group: 'community',
      getValue: (b) => (b.forks !== null ? formatCompactNumber(b.forks) : 'N/A'),
    },
    {
      label: 'Contributors',
      group: 'community',
      getValue: (b) => (b.contributors !== null ? formatCompactNumber(b.contributors) : 'N/A'),
    },
    {
      label: 'Open Issues',
      group: 'community',
      getValue: (b) => (b.openIssues !== null ? formatCompactNumber(b.openIssues) : 'N/A'),
    },
    {
      label: 'Closed Issues',
      group: 'community',
      getValue: (b) => (b.closedIssues !== null ? formatCompactNumber(b.closedIssues) : 'N/A'),
    },
  ];

  const filteredRows = metricRows.filter(
    (r) => selectedMetricGroup === 'all' || r.group === selectedMetricGroup
  );

  return (
    <div className="reports-card" style={{ gap: 20 }}>
      {/* Header & Metric Group Filter */}
      <div className="reports-card-header" style={{ marginBottom: 0 }}>
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">
            <GitCompare size={20} color="#386BFF" />
            <span>Repository Benchmarks Comparison</span>
          </h2>
          <span className="reports-card-subtitle">
            Side-by-side comparative analysis of structural complexity, architecture health, and volume.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {(['all', 'code', 'architecture', 'community'] as const).map((group) => (
            <button
              key={group}
              type="button"
              className={`reports-nav-pill-btn ${selectedMetricGroup === group ? 'active' : ''}`}
              onClick={() => setSelectedMetricGroup(group)}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              {group.charAt(0).toUpperCase() + group.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Comparison Table */}
      <div className="benchmarks-table-wrap">
        <table className="benchmarks-table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>Metric & Definition</th>
              {benchmarks.map((repo) => (
                <th
                  key={repo.id}
                  className={repo.isCurrent ? 'current-repo-header' : ''}
                  style={{ width: `${75 / benchmarks.length}%` }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {repo.isCurrent ? '★ Current Repository' : repo.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.8,
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {repo.fullName}
                  </div>
                  {repo.isReferenceBenchmark && (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 9.5,
                        background: 'rgba(139, 92, 246, 0.2)',
                        color: '#C084FC',
                        padding: '1px 6px',
                        borderRadius: 4,
                        marginTop: 2,
                      }}
                    >
                      Reference Baseline
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.label}>
                <td>
                  <div style={{ fontWeight: 600 }}>{row.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-supporting)', marginTop: 2 }}>
                    {metricsDefinitions[row.label]}
                  </div>
                </td>

                {benchmarks.map((repo) => {
                  const val = row.getValue(repo);
                  const isAvailable = val !== 'N/A';

                  return (
                    <td
                      key={repo.id}
                      className={repo.isCurrent ? 'current-repo-cell' : ''}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: isAvailable
                          ? repo.isCurrent
                            ? '#F3F6FF'
                            : 'var(--color-text)'
                          : 'var(--color-text-supporting)',
                      }}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Integrity & Attribution Notice */}
      <div
        style={{
          background: 'rgba(12, 20, 42, 0.6)',
          border: '1px solid rgba(135, 155, 255, 0.12)',
          borderRadius: 12,
          padding: '12px 16px',
          fontSize: 12,
          color: 'var(--color-text-supporting)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Info size={16} color="#38BDF8" style={{ flexShrink: 0 }} />
        <span>
          <strong>Benchmark Integrity:</strong> Metrics are strictly derived from analyzed AST models and verified metadata.
          GitHub hosting metrics (stars, forks, open/closed issues) are distinguished from local AST calculations and display <code>N/A</code> when hosting statistics are unavailable.
        </span>
      </div>
    </div>
  );
}
