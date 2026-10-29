import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, AlertTriangle, Bug, ExternalLink, CheckCircle } from 'lucide-react';
import type { CodeIssue, CodeInspectionSummary } from '../../lib/api';
import { CATEGORY_LABELS } from '../explorer/codeInspectionTypes';

interface CodeQualityCardProps {
  codeIssues?: CodeIssue[];
  codeIssuesSummary?: CodeInspectionSummary;
  repoId?: string;
}

export function CodeQualityCard({
  codeIssues = [],
  codeIssuesSummary,
  repoId,
}: CodeQualityCardProps) {
  const total = codeIssuesSummary?.total ?? codeIssues.length;
  const errors = codeIssuesSummary?.errors ?? codeIssues.filter((i) => i.severity === 'error').length;
  const warnings = codeIssuesSummary?.warnings ?? codeIssues.filter((i) => i.severity === 'warning').length;
  const info = codeIssuesSummary?.info ?? codeIssues.filter((i) => i.severity === 'info').length;

  // Group issues by file to find top files with issues
  const issuesByFile = React.useMemo(() => {
    const map = new Map<string, { count: number; errors: number; warnings: number }>();
    for (const issue of codeIssues) {
      const file = issue.file || 'unknown';
      if (!map.has(file)) {
        map.set(file, { count: 0, errors: 0, warnings: 0 });
      }
      const entry = map.get(file)!;
      entry.count++;
      if (issue.severity === 'error') entry.errors++;
      if (issue.severity === 'warning') entry.warnings++;
    }
    return Array.from(map.entries())
      .map(([path, data]) => ({ path, ...data }))
      .sort((a, b) => b.errors - a.errors || b.count - a.count);
  }, [codeIssues]);

  // Group by category
  const categoryCounts = React.useMemo(() => {
    if (codeIssuesSummary?.byCategory) {
      return codeIssuesSummary.byCategory;
    }
    const map: Record<string, number> = {};
    for (const issue of codeIssues) {
      map[issue.category] = (map[issue.category] || 0) + 1;
    }
    return map;
  }, [codeIssuesSummary, codeIssues]);

  return (
    <div className="health-card health-col-6" id="section-code-quality">
      <div className="health-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bug size={18} color="#FF717A" />
          <h2 className="health-card-title">Code Quality & Bugs</h2>
        </div>
        {repoId && issuesByFile.length > 0 && (
          <Link
            to={`/explorer?repo=${repoId}&path=${encodeURIComponent(issuesByFile[0].path)}`}
            className="health-card-action-btn"
            style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span>Open in Explorer</span>
            <ExternalLink size={12} />
          </Link>
        )}
      </div>

      <div style={{ padding: '4px 0' }}>
        {total === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 24,
              borderRadius: 8,
              background: 'rgba(112, 232, 186, 0.08)',
              border: '1px solid rgba(112, 232, 186, 0.2)',
              color: '#70E8BA',
            }}
          >
            <CheckCircle size={24} color="#70E8BA" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#EAF0FF', marginBottom: 2 }}>
                High Code Health
              </div>
              <div style={{ fontSize: 12, color: '#A7B4CC' }}>
                Static AST inspection detected no dead code, runtime errors, or common vulnerability patterns.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Severity Breakdown Bar */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#EF4444',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <ShieldAlert size={14} />
                <span>{errors} Errors</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#F59E0B',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <AlertTriangle size={14} />
                <span>{warnings} Warnings</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'rgba(59, 130, 246, 0.12)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  color: '#3B82F6',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span>{info} Info</span>
              </div>
            </div>

            {/* Top Categories */}
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#77839C', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>
                Detected Issue Categories
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(categoryCounts).map(([cat, count]) => {
                  if (count === 0) return null;
                  const label = CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat;
                  return (
                    <div
                      key={cat}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        fontSize: 11,
                        color: '#EAF0FF',
                      }}
                    >
                      <span>{label}</span>
                      <span
                        style={{
                          background: 'rgba(255, 113, 122, 0.2)',
                          color: '#FF717A',
                          padding: '1px 5px',
                          borderRadius: 4,
                          fontWeight: 700,
                          fontSize: 10,
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Files with Issues */}
            {issuesByFile.length > 0 && (
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#77839C', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>
                  Files Requiring Attention
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {issuesByFile.slice(0, 4).map((f) => (
                    <div
                      key={f.path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'rgba(3, 7, 18, 0.4)',
                        border: '1px solid rgba(135, 155, 255, 0.1)',
                        fontSize: 12,
                      }}
                    >
                      {repoId ? (
                        <Link
                          to={`/explorer?repo=${repoId}&path=${encodeURIComponent(f.path)}`}
                          style={{
                            color: '#6898FF',
                            textDecoration: 'none',
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '70%',
                          }}
                          title={`Inspect ${f.path}`}
                        >
                          {f.path}
                        </Link>
                      ) : (
                        <span style={{ color: '#EAF0FF', fontFamily: 'var(--font-mono)' }}>{f.path}</span>
                      )}
                      <div style={{ display: 'flex', gap: 6 }}>
                        {f.errors > 0 && (
                          <span style={{ color: '#EF4444', fontSize: 11, fontWeight: 600 }}>
                            {f.errors} err
                          </span>
                        )}
                        {f.warnings > 0 && (
                          <span style={{ color: '#F59E0B', fontSize: 11, fontWeight: 600 }}>
                            {f.warnings} warn
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
