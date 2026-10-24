import React, { useMemo, useState } from 'react';
import { X, Search, ExternalLink, AlertTriangle, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { IArchitecturalIssue } from '../../lib/api';
import type { SeverityLevel, SeverityCategoryInfo, ComplexityBucket } from './healthTypes';
import { classifyIssueSeverity } from './healthCalculation';

interface FindingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  issues: IArchitecturalIssue[];
  initialSeverity?: SeverityLevel | 'all';
  complexityBucket?: ComplexityBucket | null;
  repoId?: string;
}

export function FindingsModal({
  isOpen,
  onClose,
  issues,
  initialSeverity = 'all',
  complexityBucket = null,
  repoId,
}: FindingsModalProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SeverityLevel | 'all' | 'complexity'>(
    complexityBucket ? 'complexity' : initialSeverity
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Reset tab when modal opens or initialSeverity/complexityBucket changes
  React.useEffect(() => {
    if (complexityBucket) {
      setActiveTab('complexity');
    } else {
      setActiveTab(initialSeverity);
    }
  }, [isOpen, initialSeverity, complexityBucket]);

  // Filter issues
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      const sev = classifyIssueSeverity(issue);
      if (activeTab !== 'all' && activeTab !== 'complexity' && sev !== activeTab) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesFile = issue.file.toLowerCase().includes(q);
        const matchesDesc = issue.description.toLowerCase().includes(q);
        const matchesRule = issue.rule.toLowerCase().includes(q);
        return matchesFile || matchesDesc || matchesRule;
      }
      return true;
    });
  }, [issues, activeTab, searchQuery]);

  // Filter complexity files
  const filteredComplexityFiles = useMemo(() => {
    if (!complexityBucket) return [];
    return complexityBucket.files.filter((f) => {
      if (searchQuery.trim()) {
        return f.path.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [complexityBucket, searchQuery]);

  if (!isOpen) return null;

  const handleOpenCode = (path: string, line?: number) => {
    if (!repoId) return;
    const url = `/explorer?repo=${repoId}&path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`;
    navigate(url);
    onClose();
  };

  return (
    <div className="health-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="health-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="health-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={20} color="#FFD166" />
            <h2 className="health-modal-title">
              {complexityBucket
                ? `Complexity: ${complexityBucket.label} (${complexityBucket.range})`
                : 'Architectural Findings'}
            </h2>
          </div>
          <button
            type="button"
            className="health-modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Severity Tabs (if not exclusively in complexity mode) */}
        {!complexityBucket && (
          <div className="health-modal-tabs">
            {(['all', 'critical', 'high', 'medium', 'low'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`health-modal-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="health-modal-search">
          <div className="health-search-wrapper" style={{ width: '100%' }}>
            <Search size={15} className="health-search-icon" />
            <input
              type="text"
              className="health-search-input"
              placeholder={
                complexityBucket ? 'Search modules in this range...' : 'Search findings by file or rule...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Results List */}
        <div className="health-modal-list">
          {complexityBucket ? (
            /* Complexity files list */
            filteredComplexityFiles.length > 0 ? (
              filteredComplexityFiles.map((file, idx) => (
                <div key={idx} className="health-modal-finding-card">
                  <div className="health-modal-finding-header">
                    <span className="health-modal-finding-file">{file.path}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: complexityBucket.color,
                        fontWeight: 600,
                      }}
                    >
                      Score: {file.complexity} {file.lines > 0 ? `(${file.lines} lines)` : ''}
                    </span>
                  </div>
                  <div className="health-modal-finding-footer">
                    <span style={{ fontSize: 11, color: 'var(--color-text-supporting)' }}>
                      Range: {complexityBucket.range}
                    </span>
                    <button
                      type="button"
                      className="health-modal-open-code-btn"
                      onClick={() => handleOpenCode(file.path)}
                    >
                      <span>Open in Code Explorer</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--color-text-supporting)' }}>
                No modules match search criteria in this range.
              </div>
            )
          ) : /* Issues findings list */
          filteredIssues.length > 0 ? (
            filteredIssues.map((issue, idx) => {
              const sev = classifyIssueSeverity(issue);
              return (
                <div key={issue.id || idx} className="health-modal-finding-card">
                  <div className="health-modal-finding-header">
                    <span className="health-modal-finding-file">
                      {issue.file}
                      {issue.line ? `:${issue.line}` : ''}
                    </span>
                    <span className={`risk-severity-badge ${sev}`}>{sev}</span>
                  </div>

                  <div style={{ fontWeight: 600, fontSize: 13, color: '#F3F6FF' }}>
                    {issue.rule}
                  </div>

                  <div className="health-modal-finding-desc">{issue.description}</div>

                  {issue.affectedFiles && issue.affectedFiles.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-supporting)' }}>
                      Involved files: {issue.affectedFiles.join(', ')}
                    </div>
                  )}

                  <div className="health-modal-finding-footer">
                    <span style={{ fontSize: 10.5, color: 'var(--color-text-supporting)' }}>
                      Confidence: {issue.confidence || 'heuristic'}
                    </span>
                    <button
                      type="button"
                      className="health-modal-open-code-btn"
                      onClick={() => handleOpenCode(issue.file, issue.line)}
                    >
                      <span>Open in Code Explorer</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--color-text-supporting)' }}>
              No findings found matching current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
