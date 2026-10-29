import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Network,
  GitFork,
  BarChart2,
  Package,
  Layers,
  Info,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import { generateFileSummary } from './explorerSummary';
import type { ExplorerFileItem } from './explorerTypes';
import type { CodeIssue } from '../../lib/api';

interface ContextPanelProps {
  currentFile: ExplorerFileItem | null;
  sourceCode: string | null;
  onNavigateToFile: (path: string, line?: number) => void;
  issues?: CodeIssue[];
  onSelectLine?: (line: number) => void;
}

function extractImportedSymbols(sourceCode: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!sourceCode) return map;

  const esImportRe = /import\s+(?:([\w*$\s{},]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportRe.exec(sourceCode)) !== null) {
    const clause = match[1]?.trim();
    const spec = match[2]?.trim();
    if (spec && clause) {
      const cleaned = clause
        .replace(/\s+/g, ' ')
        .replace(/\btype\s+/g, '')
        .replace(/\bas\s+[\w$]+/g, '')
        .replace(/[{}]/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (cleaned.length > 0) {
        const formatted = cleaned
          .slice(0, 3)
          .map((item) => (/^[a-z][\w$]*$/.test(item) && !['react', 'default'].includes(item.toLowerCase()) ? `${item}()` : item))
          .join(', ');
        map.set(spec, formatted + (cleaned.length > 3 ? '…' : ''));
      }
    }
  }
  return map;
}

export function ContextPanel({
  currentFile,
  sourceCode,
  onNavigateToFile,
  issues = [],
  onSelectLine,
}: ContextPanelProps) {
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [depsExpanded, setDepsExpanded] = useState(true);
  const [dependentsExpanded, setDependentsExpanded] = useState(true);
  const [issuesExpanded, setIssuesExpanded] = useState(true);

  // Parse imported symbols for display
  const importedSymbols = useMemo(() => {
    return extractImportedSymbols(sourceCode);
  }, [sourceCode]);

  // Generate contextual AI summary from actual evidence
  const summary = useMemo(() => {
    if (!currentFile) return null;
    return generateFileSummary(currentFile, sourceCode);
  }, [currentFile, sourceCode]);

  const handleCopySummary = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary.description);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  if (!currentFile) {
    return (
      <aside className="explorer-panel context-panel" aria-label="File Details">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            textAlign: 'center',
            color: '#77839C',
            marginTop: 'auto',
            marginBottom: 'auto',
          }}
        >
          <Info size={28} color="#8B78FF" />
          <div style={{ fontSize: 13, color: '#A7B4CC' }}>
            Select any file to inspect its architectural summary, dependencies, and metrics.
          </div>
        </div>
      </aside>
    );
  }

  // File metrics calculations
  const loc = currentFile.lines > 0 ? currentFile.lines : currentFile.size > 0 ? currentFile.lines : null;
  
  // Distinguish supported function counts from unavailable
  const hasFunctionsSupport =
    ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.java', '.py', '.go'].includes(
      currentFile.ext.toLowerCase()
    );
  const functionCount = hasFunctionsSupport ? currentFile.functions.length : null;

  // Class/interface counts
  const classCount = currentFile.functions.filter((f) => f.kind === 'class').length;
  // If TS/Java, interfaces/types can be counted
  const isTsOrJava = ['.ts', '.tsx', '.java'].includes(currentFile.ext.toLowerCase());
  let interfaceCount: number | null = null;
  if (hasFunctionsSupport) {
    if (isTsOrJava && sourceCode) {
      const ifaceMatches = sourceCode.match(/\b(?:interface|type)\s+([A-Za-z_$][\w$]*)/g);
      interfaceCount = ifaceMatches ? ifaceMatches.length : (classCount > 0 ? classCount : 0);
    } else if (isTsOrJava) {
      interfaceCount = classCount > 0 ? classCount : (currentFile.exports.some((e) => typeof e === 'object' && (e as any).kind === 'export') ? 1 : 0);
    } else {
      interfaceCount = classCount > 0 ? classCount : null;
    }
  }

  // Dependencies count
  const hasDepsSupport = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.java'].includes(
    currentFile.ext.toLowerCase()
  );
  const depCount = hasDepsSupport ? currentFile.outgoingDeps.length : null;

  return (
    <aside className="explorer-panel context-panel" aria-label="File Context">
      {/* 1. AI Summary Card */}
      {summary && (
        <div className="context-card">
          <div className="context-card-header">
            <h3 className="context-card-title">
              <Sparkles size={16} color="#8B78FF" />
              AI Summary
            </h3>
            <button
              type="button"
              className="viewer-icon-btn"
              onClick={handleCopySummary}
              title={copiedSummary ? 'Copied summary!' : 'Copy summary text'}
              aria-label="Copy summary text"
            >
              {copiedSummary ? <Check size={14} color="#70E8BA" /> : <Copy size={14} />}
            </button>
          </div>

          <p className="context-card-text">{summary.description}</p>

          {/* Badges / Labels row */}
          {summary.badges.length > 0 && (
            <div className="context-badge-row">
              {summary.badges.map((b) => (
                <span key={b} className="context-badge">
                  {b}
                </span>
              ))}
            </div>
          )}

          {/* Honest Disclosure */}
          <div
            style={{
              fontSize: 10,
              color: '#77839C',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              borderTop: '1px solid rgba(135, 155, 255, 0.08)',
              paddingTop: 8,
              marginTop: 2,
            }}
          >
            <span style={{ color: '#8B78FF' }}>⚡</span>
            {summary.disclaimer}
          </div>
        </div>
      )}

      {/* 2. Dependencies (N) Card */}
      <div className="context-card">
        <div
          className="context-card-header"
          onClick={() => setDepsExpanded(!depsExpanded)}
          role="button"
          tabIndex={0}
          aria-expanded={depsExpanded}
        >
          <h3 className="context-card-title">
            <Network size={16} color="#F472B6" />
            Dependencies ({currentFile.outgoingDeps.length})
          </h3>
          <span style={{ color: '#77839C' }}>
            {depsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>

        {depsExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {currentFile.outgoingDeps.length === 0 ? (
              <div style={{ fontSize: 11, color: '#77839C', padding: '6px 2px' }}>
                {!hasDepsSupport
                  ? `Dependency tracing is not yet supported for ${currentFile.language || 'this language'}.`
                  : 'This file does not import any other local modules or packages.'}
              </div>
            ) : (
              currentFile.outgoingDeps.map((dep, idx) => {
                const isClickable = dep.isLocal && dep.resolvedPath;
                return (
                  <div
                    key={`${dep.specifier}-${idx}`}
                    className={`dep-item-row ${isClickable ? 'clickable' : ''}`}
                    onClick={() => {
                      if (isClickable && dep.resolvedPath) {
                        onNavigateToFile(dep.resolvedPath, dep.line);
                      }
                    }}
                    title={isClickable ? `Jump to ${dep.resolvedPath}` : dep.specifier}
                  >
                    <div className="dep-item-left">
                      {dep.isLocal ? (
                        <FileIcon name={dep.specifier} size={14} style={{ flexShrink: 0 }} />
                      ) : dep.isBuiltin ? (
                        <Layers size={14} color="#37D9FF" style={{ flexShrink: 0 }} />
                      ) : (
                        <Package size={14} color="#FFD166" style={{ flexShrink: 0 }} />
                      )}
                      <span className="dep-item-name">{dep.specifier}</span>
                    </div>
                    <div className="dep-item-right">
                      {importedSymbols.get(dep.specifier) || dep.detail || (dep.line ? `line ${dep.line}` : dep.isExternal ? 'package' : 'local')}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 3. Dependents (N) Card */}
      <div className="context-card">
        <div
          className="context-card-header"
          onClick={() => setDependentsExpanded(!dependentsExpanded)}
          role="button"
          tabIndex={0}
          aria-expanded={dependentsExpanded}
        >
          <h3 className="context-card-title">
            <GitFork size={16} color="#38BDF8" />
            Dependents ({currentFile.incomingDeps.length})
          </h3>
          <span style={{ color: '#77839C' }}>
            {dependentsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>

        {dependentsExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {currentFile.incomingDeps.length === 0 ? (
              <div style={{ fontSize: 11, color: '#77839C', padding: '6px 2px' }}>
                {!hasDepsSupport
                  ? `Dependency tracing is not yet supported for ${currentFile.language || 'this language'}.`
                  : 'No other local files import this module directly.'}
              </div>
            ) : (
              currentFile.incomingDeps.map((dep, idx) => (
                <div
                  key={`${dep.path}-${idx}`}
                  className="dep-item-row clickable"
                  onClick={() => onNavigateToFile(dep.path, dep.line)}
                  title={`Open ${dep.path}`}
                >
                  <div className="dep-item-left">
                    <FileIcon name={dep.name} size={14} style={{ flexShrink: 0 }} />
                    <span className="dep-item-name">{dep.name}</span>
                  </div>
                  <div className="dep-item-right">
                    {dep.folder ? `/${dep.folder}` : '/root'}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 4. File Metrics Card */}
      <div className="context-card">
        <div className="context-card-header">
          <h3 className="context-card-title">
            <BarChart2 size={16} color="#818CF8" />
            File Metrics
          </h3>
        </div>

        <div className="metrics-grid">
          <div className="metric-box">
            <span className="metric-val">
              {loc !== null ? loc.toLocaleString() : 'N/A'}
            </span>
            <span className="metric-label">Lines of Code</span>
          </div>

          <div className="metric-box">
            <span className="metric-val">
              {functionCount !== null ? functionCount : 'N/A'}
            </span>
            <span className="metric-label">Functions</span>
          </div>

          <div className="metric-box">
            <span className="metric-val">
              {interfaceCount !== null ? interfaceCount : 'N/A'}
            </span>
            <span className="metric-label">Interfaces</span>
          </div>

          <div className="metric-box">
            <span className="metric-val">
              {depCount !== null ? depCount : 'N/A'}
            </span>
            <span className="metric-label">Dependencies</span>
          </div>
        </div>
      </div>

      {/* 5. Code Inspection Card */}
      <div className="context-card">
        <div
          className="context-card-header"
          onClick={() => setIssuesExpanded(!issuesExpanded)}
          role="button"
          tabIndex={0}
          aria-expanded={issuesExpanded}
        >
          <h3 className="context-card-title">
            <AlertTriangle size={16} color={issues.length > 0 ? '#EF4444' : '#70E8BA'} />
            Code Inspection ({issues.length})
          </h3>
          <span style={{ color: '#77839C' }}>
            {issuesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>

        {issuesExpanded && (
          <div>
            {issues.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 4px',
                  color: '#70E8BA',
                  fontSize: 12,
                }}
              >
                <CheckCircle size={16} color="#70E8BA" />
                <span>Clean file — No static AST or security issues detected.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {issues.slice(0, 10).map((issue) => {
                  const sevColor =
                    issue.severity === 'error'
                      ? '#EF4444'
                      : issue.severity === 'warning'
                      ? '#F59E0B'
                      : '#3B82F6';
                  return (
                    <div
                      key={issue.id}
                      className="dep-item-row clickable"
                      onClick={() => onSelectLine?.(issue.line)}
                      title={`Jump to line ${issue.line}: ${issue.message}`}
                    >
                      <div className="dep-item-left" style={{ gap: 8 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: `${sevColor}22`,
                            color: sevColor,
                            border: `1px solid ${sevColor}44`,
                            flexShrink: 0,
                          }}
                        >
                          L{issue.line}
                        </span>
                        <span
                          className="dep-item-name"
                          style={{
                            fontSize: 12,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {issue.message}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {issues.length > 10 && (
                  <div style={{ fontSize: 11, color: '#77839C', padding: '4px 2px' }}>
                    + {issues.length - 10} more issues in Problems drawer
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
