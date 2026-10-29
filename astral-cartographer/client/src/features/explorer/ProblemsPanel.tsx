import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  ExternalLink,
  Code2,
  Wand2,
} from 'lucide-react';
import type { CodeIssue, CodeIssueCategory, CodeIssueSeverity } from '../../lib/api';
import { CATEGORY_METAS, SEVERITY_METAS } from './codeInspectionTypes';

interface ProblemsPanelProps {
  issues: CodeIssue[];
  isLoading: boolean;
  onSelectLine: (line: number) => void;
  onRunAiInspection?: () => void;
  isAiLoading?: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  activeFilePath?: string;
}

export function ProblemsPanel({
  issues,
  isLoading,
  onSelectLine,
  onRunAiInspection,
  isAiLoading = false,
  isOpen,
  onToggleOpen,
  activeFilePath,
}: ProblemsPanelProps) {
  const [selectedSeverity, setSelectedSeverity] = useState<CodeIssueSeverity | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<CodeIssueCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  // Counts by severity
  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    for (const issue of issues) {
      if (issue.severity === 'error') errors++;
      else if (issue.severity === 'warning') warnings++;
      else if (issue.severity === 'info') info++;
    }
    return { total: issues.length, errors, warnings, info };
  }, [issues]);

  // Filtered issues
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (selectedSeverity !== 'all' && issue.severity !== selectedSeverity) return false;
      if (selectedCategory !== 'all' && issue.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchMsg = issue.message.toLowerCase().includes(q);
        const matchRule = issue.ruleName.toLowerCase().includes(q);
        const matchExpl = issue.explanation.toLowerCase().includes(q);
        const matchFix = (issue.suggestedFix || '').toLowerCase().includes(q);
        if (!matchMsg && !matchRule && !matchExpl && !matchFix) return false;
      }
      return true;
    });
  }, [issues, selectedSeverity, selectedCategory, searchQuery]);

  return (
    <div
      className={`problems-panel ${isOpen ? 'open' : 'collapsed'}`}
      style={{
        borderTop: '1px solid rgba(135, 155, 255, 0.18)',
        background: 'rgba(5, 10, 24, 0.96)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: isOpen ? '320px' : '38px',
        transition: 'max-height 0.25s ease',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {/* 1. Panel Header */}
      <div
        className="problems-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          background: 'rgba(12, 19, 40, 0.98)',
          cursor: 'pointer',
          userSelect: 'none',
          minHeight: '38px',
        }}
        onClick={onToggleOpen}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: '#EAF0FF' }}>
            <AlertCircle size={15} color={counts.errors > 0 ? '#FF717A' : counts.warnings > 0 ? '#FFAD66' : '#8B78FF'} />
            <span>Problems</span>
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 10,
                background: counts.total > 0 ? 'rgba(139, 120, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                color: counts.total > 0 ? '#A99AFF' : '#77839C',
              }}
            >
              {counts.total}
            </span>
          </div>

          {/* Severity Counters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: counts.errors > 0 ? '#FF717A' : '#77839C', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9 }}>🔴</span> {counts.errors} {counts.errors === 1 ? 'Error' : 'Errors'}
            </span>
            <span style={{ color: counts.warnings > 0 ? '#FFAD66' : '#77839C', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9 }}>🟡</span> {counts.warnings} {counts.warnings === 1 ? 'Warning' : 'Warnings'}
            </span>
            <span style={{ color: counts.info > 0 ? '#38BDF8' : '#77839C', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9 }}>🔵</span> {counts.info} Info
            </span>
          </div>
        </div>

        {/* Right Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} onClick={(e) => e.stopPropagation()}>
          {onRunAiInspection && (
            <button
              type="button"
              className="viewer-icon-btn"
              onClick={onRunAiInspection}
              disabled={isAiLoading || !activeFilePath}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                fontSize: 11,
                borderRadius: 6,
                background: isAiLoading ? 'rgba(139, 120, 255, 0.1)' : 'rgba(139, 120, 255, 0.18)',
                border: '1px solid rgba(139, 120, 255, 0.35)',
                color: '#C4B5FD',
              }}
              title="Use AI to inspect active file for subtle logical flaws or unhandled edge cases"
            >
              <Sparkles size={13} className={isAiLoading ? 'spin' : ''} />
              <span>{isAiLoading ? 'AI Inspecting…' : 'AI Inspect File'}</span>
            </button>
          )}

          <button
            type="button"
            className="viewer-icon-btn"
            onClick={onToggleOpen}
            aria-label={isOpen ? 'Collapse Problems Panel' : 'Expand Problems Panel'}
            title={isOpen ? 'Collapse panel' : 'Expand panel'}
          >
            {isOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {/* 2. Filter Bar (when open) */}
      {isOpen && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 14px',
            background: 'rgba(8, 14, 30, 0.95)',
            borderBottom: '1px solid rgba(135, 155, 255, 0.1)',
            fontSize: 11,
          }}
        >
          {/* Severity Pills */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'error', 'warning', 'info'] as const).map((sev) => {
              const active = selectedSeverity === sev;
              const meta = sev === 'all' ? null : SEVERITY_METAS[sev];
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSelectedSeverity(sev)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    background: active ? (meta ? meta.color + '26' : 'rgba(255, 255, 255, 0.15)') : 'transparent',
                    border: `1px solid ${active ? (meta ? meta.color : '#8B78FF') : 'rgba(255, 255, 255, 0.1)'}`,
                    color: active ? (meta ? meta.color : '#EAF0FF') : '#8898B0',
                    cursor: 'pointer',
                  }}
                >
                  {sev === 'all' ? `All (${counts.total})` : `${meta?.label} (${counts[sev === 'error' ? 'errors' : sev === 'warning' ? 'warnings' : 'info']})`}
                </button>
              );
            })}
          </div>

          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as any)}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: 11,
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(135, 155, 255, 0.2)',
              color: '#C8D5E8',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_METAS).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>

          {/* Search Box */}
          <div style={{ position: 'relative', flex: 1, maxWidth: 220, marginLeft: 'auto' }}>
            <Search size={12} color="#77839C" style={{ position: 'absolute', left: 7, top: 6 }} />
            <input
              type="text"
              placeholder="Filter problems…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '3px 8px 3px 24px',
                borderRadius: 4,
                fontSize: 11,
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(135, 155, 255, 0.2)',
                color: '#EAF0FF',
                outline: 'none',
              }}
            />
          </div>
        </div>
      )}

      {/* 3. Problems List Area (when open) */}
      {isOpen && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {isLoading ? (
            <div style={{ padding: 18, textAlign: 'center', color: '#A7B4CC', fontSize: 12 }}>
              Analyzing code structure and checking rules…
            </div>
          ) : filteredIssues.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: 24,
                color: '#70E8BA',
                fontSize: 12,
              }}
            >
              <CheckCircle2 size={16} />
              <span>
                {issues.length === 0
                  ? 'No programming mistakes or rule violations detected in this file.'
                  : 'No problems match the current filter.'}
              </span>
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const catMeta = CATEGORY_METAS[issue.category] || CATEGORY_METAS.logical_error;
              const sevMeta = SEVERITY_METAS[issue.severity];
              const isExpanded = expandedIssueId === issue.id;

              return (
                <div
                  key={issue.id}
                  style={{
                    borderBottom: '1px solid rgba(135, 155, 255, 0.08)',
                    background: isExpanded ? 'rgba(139, 120, 255, 0.05)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => onSelectLine(issue.line)}
                >
                  {/* Issue Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 14px',
                      fontSize: 12,
                    }}
                  >
                    {/* Line Badge */}
                    <span
                      style={{
                        flexShrink: 0,
                        padding: '1px 6px',
                        borderRadius: 3,
                        background: 'rgba(255, 255, 255, 0.07)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: '#A9B7D0',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 11,
                      }}
                      title={`Jump to line ${issue.line}`}
                    >
                      Line {issue.line}
                    </span>

                    {/* Severity Indicator */}
                    <span style={{ flexShrink: 0, fontSize: 10 }} title={sevMeta.label}>
                      {sevMeta.icon}
                    </span>

                    {/* Category Badge */}
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 3,
                        background: catMeta.bg,
                        border: `1px solid ${catMeta.border}`,
                        color: catMeta.color,
                      }}
                    >
                      {catMeta.label}
                    </span>

                    {/* Confidence Tag */}
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: issue.confidence === 'confirmed' ? 'rgba(112, 232, 186, 0.12)' : 'rgba(255, 209, 102, 0.12)',
                        border: `1px solid ${issue.confidence === 'confirmed' ? 'rgba(112, 232, 186, 0.3)' : 'rgba(255, 209, 102, 0.3)'}`,
                        color: issue.confidence === 'confirmed' ? '#70E8BA' : '#FFD166',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {issue.confidence}
                    </span>

                    {/* Message */}
                    <span style={{ flex: 1, color: '#EAF0FF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {issue.message}
                    </span>

                    {/* Expand / Details Toggle */}
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#77839C',
                        cursor: 'pointer',
                        padding: 4,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIssueId(isExpanded ? null : issue.id);
                      }}
                      title="View explanation and suggested fix"
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {/* Expanded Detail (Explanation & Fix) */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: '6px 14px 12px 42px',
                        fontSize: 11,
                        color: '#A7B4CC',
                        lineHeight: 1.6,
                        borderTop: '1px dashed rgba(135, 155, 255, 0.12)',
                      }}
                    >
                      <div style={{ marginBottom: 6 }}>
                        <strong style={{ color: '#EAF0FF' }}>Rule:</strong> {issue.ruleName}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <strong style={{ color: '#EAF0FF' }}>Why this matters:</strong> {issue.explanation}
                      </div>

                      {issue.codeSnippet && (
                        <div
                          style={{
                            margin: '6px 0',
                            padding: '4px 8px',
                            borderRadius: 4,
                            background: 'rgba(3, 7, 18, 0.8)',
                            border: '1px solid rgba(135, 155, 255, 0.15)',
                            fontFamily: 'var(--font-mono, monospace)',
                            color: '#FFAD66',
                            fontSize: 11,
                          }}
                        >
                          {issue.codeSnippet}
                        </div>
                      )}

                      {issue.suggestedFix && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: 'rgba(112, 232, 186, 0.08)',
                            border: '1px solid rgba(112, 232, 186, 0.25)',
                            color: '#99F6E4',
                          }}
                        >
                          <strong style={{ color: '#70E8BA' }}>Suggested Fix:</strong> {issue.suggestedFix}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
