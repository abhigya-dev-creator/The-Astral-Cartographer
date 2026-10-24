import React, { useState } from 'react';
import {
  FileText,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  FolderTree,
  GitFork,
  Layers,
  Compass,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AnalysisDetails, RepositorySummary } from '../../lib/api';
import type {
  KpiSummaryData,
  CodebaseCompositionData,
  ProjectStructureNode,
  ReportInsightItem,
} from './reportsTypes';
import { formatCompactNumber } from './reportsCalculation';

interface DetailedReportTabProps {
  repo: RepositorySummary | null;
  analysis: AnalysisDetails | null;
  kpis: KpiSummaryData;
  composition: CodebaseCompositionData;
  structure: ProjectStructureNode[];
  insights: ReportInsightItem[];
}

export function DetailedReportTab({
  repo,
  analysis,
  kpis,
  composition,
  structure,
  insights,
}: DetailedReportTabProps) {
  const [copied, setCopied] = useState(false);

  const metrics = analysis?.metrics;
  const issues = analysis?.issues || [];

  const handleCopy = () => {
    const text = document.getElementById('detailed-report-container')?.innerText || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="detailed-report-wrap" id="detailed-report-container">
      {/* Action header */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          type="button"
          className="health-modal-open-code-btn"
          onClick={handleCopy}
          title="Copy report text to clipboard"
        >
          {copied ? <Check size={14} color="#43D9A3" /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy Report'}</span>
        </button>
      </div>

      {/* Section 1: Executive Summary */}
      <div className="report-section-card">
        <div className="report-section-header">
          <h3 className="report-section-title">
            <FileText size={18} color="#38BDF8" />
            <span>1. Executive Summary & Repository Metadata</span>
          </h3>
          <span style={{ fontSize: 12, color: 'var(--color-text-supporting)' }}>
            Analysis Engine v{analysis?.analyzerVersion || '2.0'}
          </span>
        </div>

        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-text)' }}>
          This technical report details the architectural structure, codebase volume, modular boundaries,
          and maintainability risks for <strong>{repo?.fullName || 'the selected repository'}</strong>.
          Evaluated from revision <code>{kpis.latestCommit.shortSha || 'HEAD'}</code> on{' '}
          {kpis.latestCommit.formattedDate}.
        </p>

        <div className="report-metadata-grid">
          <div className="report-meta-item">
            <span className="report-meta-label">Primary Language</span>
            <span className="report-meta-value">{kpis.languages.primaryName}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Total Files</span>
            <span className="report-meta-value">{kpis.totalFiles.formatted}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Lines of Code</span>
            <span className="report-meta-value">{kpis.linesOfCode.formatted}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Architectural Findings</span>
            <span className="report-meta-value">{issues.length}</span>
          </div>
        </div>
      </div>

      {/* Section 2: Codebase Composition */}
      <div className="report-section-card">
        <div className="report-section-header">
          <h3 className="report-section-title">
            <Layers size={18} color="#C084FC" />
            <span>2. Codebase Composition & Language Inventory</span>
          </h3>
          <Link to="/explorer" className="health-card-action-btn" style={{ fontSize: 12 }}>
            <span>Explore in Code Explorer</span>
            <ExternalLink size={12} />
          </Link>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-supporting)' }}>
          Analysis discovered {composition.totalFiles.toLocaleString()} files across{' '}
          {composition.items.length} file types ({composition.sourceFilesCount} source code modules).
        </p>

        <div className="benchmarks-table-wrap">
          <table className="benchmarks-table">
            <thead>
              <tr>
                <th>Language / File Type</th>
                <th>File Count</th>
                <th>Lines of Code</th>
                <th>Share</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {composition.items.map((item) => (
                <tr key={item.name}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="composition-legend-dot" style={{ background: item.color }} />
                      <span>{item.name}</span>
                    </div>
                  </td>
                  <td>{item.files.toLocaleString()}</td>
                  <td>{item.lines.toLocaleString()}</td>
                  <td>{item.percentage}%</td>
                  <td>{item.isSource ? 'Source Code' : 'Asset / Configuration'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Project Structure */}
      <div className="report-section-card">
        <div className="report-section-header">
          <h3 className="report-section-title">
            <FolderTree size={18} color="#10B981" />
            <span>3. Project Structure & Organization</span>
          </h3>
          <Link to="/explorer" className="health-card-action-btn" style={{ fontSize: 12 }}>
            <span>Browse Directory Tree</span>
            <ExternalLink size={12} />
          </Link>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-supporting)' }}>
          The repository is divided into {structure.length} principal directory clusters:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {structure.map((node) => (
            <div
              key={node.name}
              style={{
                background: 'rgba(12, 20, 42, 0.6)',
                border: `1px solid ${node.color}44`,
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#F3F6FF' }}>{node.name}/</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: node.color }}>
                  {node.percentage}%
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-supporting)' }}>
                {node.fileCount.toLocaleString()} files ({formatCompactNumber(node.lines)} LOC)
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 4: Architectural Findings & Risk Register */}
      <div className="report-section-card">
        <div className="report-section-header">
          <h3 className="report-section-title">
            <AlertTriangle size={18} color="#FF717A" />
            <span>4. Architectural Findings & Risk Register</span>
          </h3>
          <Link to="/health" className="health-card-action-btn" style={{ fontSize: 12 }}>
            <span>View Architectural Health</span>
            <ExternalLink size={12} />
          </Link>
        </div>

        {issues.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {issues.slice(0, 8).map((issue, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(12, 20, 42, 0.5)',
                  border: '1px solid rgba(135, 155, 255, 0.12)',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#7DD3FC' }}>
                    {issue.file}{issue.line ? `:${issue.line}` : ''}
                  </span>
                  <span className={`risk-severity-badge ${issue.severity}`}>
                    {issue.severity}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F3F6FF' }}>{issue.rule}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-supporting)' }}>{issue.description}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: '#43D9A3', fontSize: 13 }}>
            ✓ No critical architectural anti-patterns detected in analyzed files.
          </div>
        )}
      </div>

      {/* Section 5: Analysis Coverage & Limitations */}
      <div className="report-section-card">
        <div className="report-section-header">
          <h3 className="report-section-title">
            <ShieldCheck size={18} color="#FFD166" />
            <span>5. Analysis Coverage, Limitations & Integrity</span>
          </h3>
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-supporting)' }}>
          • <strong>AST Analysis:</strong> Full abstract syntax tree parsing and import graph resolution is active for JavaScript, TypeScript, and Java modules.
          <br />
          • <strong>Non-AST Formats:</strong> JSON, CSS, Markdown, and configuration files are classified by extension and line counting.
          <br />
          • <strong>Coverage:</strong> Analysis ran on {metrics?.coverage?.analyzedCodeFiles ?? metrics?.totalFiles ?? 0} of {metrics?.coverage?.codeFiles ?? metrics?.totalFiles ?? 0} code files ({metrics?.coverage?.completeness || 'complete'} mode).
        </p>
      </div>

      {/* Section 6: Actionable Recommendations */}
      <div className="report-section-card">
        <div className="report-section-header">
          <h3 className="report-section-title">
            <Compass size={18} color="#386BFF" />
            <span>6. Actionable Recommendations & Roadmap</span>
          </h3>
          <Link to="/pathfinder" className="health-card-action-btn" style={{ fontSize: 12 }}>
            <span>Open Pathfinder Roadmap</span>
            <ExternalLink size={12} />
          </Link>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {insights.map((item) => (
            <div
              key={item.id}
              style={{
                background: 'rgba(12, 20, 42, 0.5)',
                border: '1px solid rgba(135, 155, 255, 0.1)',
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#F3F6FF' }}>{item.title}</span>
                <span className={`insight-badge ${item.type}`}>{item.type}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text)' }}>{item.description}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-supporting)' }}>
                <strong>Why it matters:</strong> {item.whyItMatters}
              </div>
              <div style={{ fontSize: 11.5, color: '#A99AFF' }}>
                <strong>Next Step:</strong> {item.suggestedNextStep}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
