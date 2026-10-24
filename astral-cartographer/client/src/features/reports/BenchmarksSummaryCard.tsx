import React, { useState } from 'react';
import type { BenchmarkRepoData } from './reportsTypes';
import { formatCompactNumber } from './reportsCalculation';

interface BenchmarksSummaryCardProps {
  benchmarks: BenchmarkRepoData[];
  onOpenFullBenchmarks?: () => void;
}

export function BenchmarksSummaryCard({
  benchmarks,
  onOpenFullBenchmarks,
}: BenchmarksSummaryCardProps) {
  const [filterMode, setFilterMode] = useState<'similar' | 'analyzed'>('similar');

  const rows: Array<{ label: string; key: keyof BenchmarkRepoData; format?: (v: any) => string }> = [
    { label: 'Stars', key: 'stars', format: (v) => (v !== null ? formatCompactNumber(v) : 'N/A') },
    { label: 'Forks', key: 'forks', format: (v) => (v !== null ? formatCompactNumber(v) : 'N/A') },
    { label: 'Contributors', key: 'contributors', format: (v) => (v !== null ? formatCompactNumber(v) : 'N/A') },
    { label: 'Lines of Code', key: 'linesOfCode', format: (v) => (v !== null ? formatCompactNumber(v) : 'N/A') },
    { label: 'Open Issues', key: 'openIssues', format: (v) => (v !== null ? formatCompactNumber(v) : 'N/A') },
    { label: 'Closed Issues', key: 'closedIssues', format: (v) => (v !== null ? formatCompactNumber(v) : 'N/A') },
  ];

  return (
    <div className="reports-card" id="section-benchmarks-summary">
      <div className="reports-card-header">
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">Repository Benchmarks</h2>
          <span className="reports-card-subtitle">Compare this repository with similar open source projects.</span>
        </div>
        <select
          className="trends-range-select"
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as any)}
          aria-label="Benchmark comparison group"
        >
          <option value="similar">Compare with Similar Repos</option>
          <option value="analyzed">Compare with Workspace Repos</option>
        </select>
      </div>

      <div className="benchmarks-table-wrap">
        <table className="benchmarks-table">
          <thead>
            <tr>
              <th>Metric</th>
              {benchmarks.map((repo) => (
                <th
                  key={repo.id}
                  className={repo.isCurrent ? 'current-repo-header' : ''}
                >
                  {repo.isCurrent ? (
                    <div>
                      <div>This Repo</div>
                      <div style={{ fontSize: 10, opacity: 0.8, fontWeight: 400 }}>({repo.name})</div>
                    </div>
                  ) : (
                    repo.name
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {benchmarks.map((repo) => {
                  const val = repo[row.key];
                  const formatted = row.format ? row.format(val) : String(val ?? 'N/A');

                  return (
                    <td
                      key={repo.id}
                      className={repo.isCurrent ? 'current-repo-cell' : ''}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
