import React, { useState } from 'react';
import {
  FileText,
  Download,
  Printer,
  FileCode,
  Check,
  AlertCircle,
  Share2,
} from 'lucide-react';
import type { AnalysisDetails, RepositorySummary } from '../../lib/api';
import type {
  KpiSummaryData,
  CodebaseCompositionData,
  ProjectStructureNode,
  BenchmarkRepoData,
  ReportInsightItem,
  ExportOptions,
} from './reportsTypes';

interface ExportTabProps {
  repo: RepositorySummary | null;
  analysis: AnalysisDetails | null;
  kpis: KpiSummaryData;
  composition: CodebaseCompositionData;
  structure: ProjectStructureNode[];
  benchmarks: BenchmarkRepoData[];
  insights: ReportInsightItem[];
  onTriggerPrint: () => void;
}

export function ExportTab({
  repo,
  analysis,
  kpis,
  composition,
  structure,
  benchmarks,
  insights,
  onTriggerPrint,
}: ExportTabProps) {
  const [selectedFormat, setSelectedFormat] = useState<'pdf' | 'markdown' | 'json'>('pdf');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [options, setOptions] = useState<ExportOptions>({
    includeExecutiveSummary: true,
    includeKeyMetrics: true,
    includeComposition: true,
    includeStructure: true,
    includeFindings: true,
    includeBenchmarks: true,
  });

  const toggleOption = (key: keyof ExportOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const generateMarkdownReport = (): string => {
    const repoName = repo?.fullName || 'Repository';
    const lines: string[] = [];

    lines.push(`# Architectural & Repository Health Report: ${repoName}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Revision: ${kpis.latestCommit.sha || 'HEAD'} (${kpis.latestCommit.formattedDate})\n`);

    if (options.includeExecutiveSummary) {
      lines.push(`## 1. Executive Summary`);
      lines.push(`- **Primary Language:** ${kpis.languages.primaryName} (${kpis.languages.primaryPercent}%)`);
      lines.push(`- **Total Files:** ${kpis.totalFiles.formatted}`);
      lines.push(`- **Lines of Code:** ${kpis.linesOfCode.formatted}`);
      lines.push(`- **Architectural Findings:** ${analysis?.issues?.length || 0}\n`);
    }

    if (options.includeComposition) {
      lines.push(`## 2. Codebase Composition`);
      lines.push(`| Language | Files | Lines of Code | Share |`);
      lines.push(`|---|---|---|---|`);
      composition.items.forEach((item) => {
        lines.push(`| ${item.name} | ${item.files} | ${item.lines} | ${item.percentage}% |`);
      });
      lines.push('');
    }

    if (options.includeStructure) {
      lines.push(`## 3. Project Structure`);
      structure.forEach((s) => {
        lines.push(`- **${s.name}/**: ${s.fileCount} files (${s.percentage}%)`);
      });
      lines.push('');
    }

    if (options.includeFindings) {
      lines.push(`## 4. Architectural Findings`);
      const issues = analysis?.issues || [];
      if (issues.length > 0) {
        issues.forEach((i, idx) => {
          lines.push(`### ${idx + 1}. [${i.severity.toUpperCase()}] ${i.rule}`);
          lines.push(`- **File:** \`${i.file}${i.line ? `:${i.line}` : ''}\``);
          lines.push(`- **Detail:** ${i.description}`);
          if (i.affectedFiles?.length) {
            lines.push(`- **Involved Files:** ${i.affectedFiles.join(', ')}`);
          }
        });
      } else {
        lines.push('No architectural anti-patterns detected in analyzed files.');
      }
      lines.push('');
    }

    if (options.includeBenchmarks) {
      lines.push(`## 5. Repository Benchmarks`);
      lines.push(`| Repository | Total Files | Lines of Code | Dependencies | Issues |`);
      lines.push(`|---|---|---|---|---|`);
      benchmarks.forEach((b) => {
        lines.push(`| ${b.name} | ${b.fileCount ?? 'N/A'} | ${b.linesOfCode ?? 'N/A'} | ${b.dependencies ?? 'N/A'} | ${b.architecturalIssues ?? 'N/A'} |`);
      });
      lines.push('');
    }

    return lines.join('\n');
  };

  const handleDownload = () => {
    try {
      const repoName = repo?.name || 'repository';

      if (selectedFormat === 'pdf') {
        onTriggerPrint();
        setStatusMessage('Print & PDF generation dialog opened.');
        return;
      }

      if (selectedFormat === 'markdown') {
        const md = generateMarkdownReport();
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `report-${repoName}.md`;
        link.click();
        URL.revokeObjectURL(url);
        setStatusMessage(`Successfully generated report-${repoName}.md`);
        return;
      }

      if (selectedFormat === 'json') {
        const data = {
          repository: repo,
          metadata: kpis,
          composition,
          structure,
          benchmarks,
          insights,
          issues: analysis?.issues || [],
          generatedAt: new Date().toISOString(),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `report-data-${repoName}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setStatusMessage(`Successfully generated report-data-${repoName}.json`);
      }
    } catch (err: any) {
      setStatusMessage(`Export failed: ${err?.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="reports-card" style={{ gap: 24 }}>
      <div className="reports-card-header" style={{ marginBottom: 0 }}>
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">
            <Share2 size={20} color="#7C3AED" />
            <span>Export & Report Generator</span>
          </h2>
          <span className="reports-card-subtitle">
            Generate printable PDF documents, Markdown summaries, or raw telemetry datasets.
          </span>
        </div>
      </div>

      <div className="export-panel-grid">
        {/* Left: Format Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#F3F6FF' }}>
            Choose Export Format:
          </label>
          <div className="export-format-selector">
            <div
              className={`export-format-card ${selectedFormat === 'pdf' ? 'selected' : ''}`}
              onClick={() => setSelectedFormat('pdf')}
            >
              <Printer size={26} color="#C084FC" />
              <div style={{ fontWeight: 700, fontSize: 14 }}>PDF Document</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-supporting)' }}>
                Printable high-res vector report
              </div>
            </div>

            <div
              className={`export-format-card ${selectedFormat === 'markdown' ? 'selected' : ''}`}
              onClick={() => setSelectedFormat('markdown')}
            >
              <FileText size={26} color="#38BDF8" />
              <div style={{ fontWeight: 700, fontSize: 14 }}>Markdown (.md)</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-supporting)' }}>
                Readable GitHub-flavored summary
              </div>
            </div>

            <div
              className={`export-format-card ${selectedFormat === 'json' ? 'selected' : ''}`}
              onClick={() => setSelectedFormat('json')}
            >
              <FileCode size={26} color="#43D9A3" />
              <div style={{ fontWeight: 700, fontSize: 14 }}>JSON (.json)</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-supporting)' }}>
                Raw structured telemetry data
              </div>
            </div>
          </div>
        </div>

        {/* Right: Section Checkboxes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#F3F6FF' }}>
            Included Report Sections:
          </label>
          <div className="export-checkbox-list">
            <label className="export-checkbox-row">
              <input
                type="checkbox"
                checked={options.includeExecutiveSummary}
                onChange={() => toggleOption('includeExecutiveSummary')}
              />
              <span>1. Executive Summary & Repository Metadata</span>
            </label>
            <label className="export-checkbox-row">
              <input
                type="checkbox"
                checked={options.includeComposition}
                onChange={() => toggleOption('includeComposition')}
              />
              <span>2. Codebase Composition & Language Inventory</span>
            </label>
            <label className="export-checkbox-row">
              <input
                type="checkbox"
                checked={options.includeStructure}
                onChange={() => toggleOption('includeStructure')}
              />
              <span>3. Project Structure & Directory Breakdown</span>
            </label>
            <label className="export-checkbox-row">
              <input
                type="checkbox"
                checked={options.includeFindings}
                onChange={() => toggleOption('includeFindings')}
              />
              <span>4. Architectural Findings & Risk Register</span>
            </label>
            <label className="export-checkbox-row">
              <input
                type="checkbox"
                checked={options.includeBenchmarks}
                onChange={() => toggleOption('includeBenchmarks')}
              />
              <span>5. Repository Benchmarks & Comparisons</span>
            </label>
          </div>
        </div>
      </div>

      {/* Action footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(135, 155, 255, 0.12)',
          paddingTop: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 12.5, color: '#43D9A3' }}>
          {statusMessage && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} />
              {statusMessage}
            </span>
          )}
        </div>

        <button
          type="button"
          className="reports-primary-action-btn"
          onClick={handleDownload}
        >
          {selectedFormat === 'pdf' ? <Printer size={16} /> : <Download size={16} />}
          <span>
            {selectedFormat === 'pdf' ? 'Open Print / Save PDF' : `Export ${selectedFormat.toUpperCase()} Report`}
          </span>
        </button>
      </div>
    </div>
  );
}
