import React from 'react';
import { FileText, Code2, Users, Clock, ArrowUpRight, ArrowDownRight, ExternalLink } from 'lucide-react';
import type { KpiSummaryData } from './reportsTypes';

interface SummaryKpiRowProps {
  kpis: KpiSummaryData;
}

export function SummaryKpiRow({ kpis }: SummaryKpiRowProps) {
  return (
    <div className="reports-kpi-row" id="section-kpi-summary">
      {/* 1. Total Files */}
      <div className="reports-kpi-card" title="Total repository files">
        <div className="reports-kpi-icon-wrap" style={{ background: 'rgba(56, 107, 255, 0.18)', color: '#386BFF' }}>
          <FileText size={20} />
        </div>
        <div className="reports-kpi-content">
          <span className="reports-kpi-label">Total Files</span>
          <span className="reports-kpi-value">{kpis.totalFiles.formatted}</span>
          {kpis.totalFiles.delta ? (
            <div className={`reports-kpi-delta ${kpis.totalFiles.delta.direction}`}>
              {kpis.totalFiles.delta.direction === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              <span>{kpis.totalFiles.delta.percent}%</span>
              <span className="reports-kpi-delta-baseline">{kpis.totalFiles.delta.baselineLabel}</span>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--color-text-supporting)', marginTop: 4 }}>
              Current snapshot
            </span>
          )}
        </div>
      </div>

      {/* 2. Lines of Code */}
      <div className="reports-kpi-card" title="Total lines of code detected across source files">
        <div className="reports-kpi-icon-wrap" style={{ background: 'rgba(56, 189, 248, 0.18)', color: '#38BDF8' }}>
          <Code2 size={20} />
        </div>
        <div className="reports-kpi-content">
          <span className="reports-kpi-label">Lines of Code</span>
          <span className="reports-kpi-value">{kpis.linesOfCode.formatted}</span>
          {kpis.linesOfCode.delta ? (
            <div className={`reports-kpi-delta ${kpis.linesOfCode.delta.direction}`}>
              {kpis.linesOfCode.delta.direction === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              <span>{kpis.linesOfCode.delta.percent}%</span>
              <span className="reports-kpi-delta-baseline">{kpis.linesOfCode.delta.baselineLabel}</span>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--color-text-supporting)', marginTop: 4 }}>
              Source LOC
            </span>
          )}
        </div>
      </div>

      {/* 3. Contributors */}
      <div className="reports-kpi-card" title="Repository contributors">
        <div className="reports-kpi-icon-wrap" style={{ background: 'rgba(139, 92, 246, 0.18)', color: '#8B5CF6' }}>
          <Users size={20} />
        </div>
        <div className="reports-kpi-content">
          <span className="reports-kpi-label">Contributors</span>
          <span className="reports-kpi-value">{kpis.contributors.formatted}</span>
          <span
            style={{
              fontSize: 10.5,
              color: 'var(--color-text-supporting)',
              marginTop: 4,
              lineHeight: 1.25,
            }}
            title={kpis.contributors.sourceLabel}
          >
            {kpis.contributors.sourceLabel}
          </span>
        </div>
      </div>

      {/* 4. Languages */}
      <div className="reports-kpi-card" title="Primary language and composition">
        <div className="reports-kpi-icon-wrap" style={{ background: 'rgba(236, 72, 153, 0.18)', color: '#EC4899' }}>
          <Code2 size={20} />
        </div>
        <div className="reports-kpi-content">
          <span className="reports-kpi-label">Languages</span>
          <span className="reports-kpi-value" style={{ fontSize: 18 }}>
            {kpis.languages.primaryName} <span style={{ fontSize: 13, color: '#38BDF8', fontWeight: 600 }}>{kpis.languages.primaryPercent}%</span>
          </span>
          <div className="reports-lang-bar-wrap">
            {kpis.languages.segments.map((seg, i) => (
              <div
                key={i}
                className="reports-lang-bar-segment"
                style={{ width: `${seg.percentage}%`, background: seg.color }}
                title={`${seg.name}: ${seg.percentage}%`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 5. Latest Commit */}
      <div className="reports-kpi-card" title="Analyzed revision commit and date">
        <div className="reports-kpi-icon-wrap" style={{ background: 'rgba(16, 185, 129, 0.18)', color: '#10B981' }}>
          <Clock size={20} />
        </div>
        <div className="reports-kpi-content">
          <span className="reports-kpi-label">Latest Commit</span>
          <span className="reports-kpi-value" style={{ fontSize: 17 }}>
            {kpis.latestCommit.relativeDate}
          </span>
          {kpis.latestCommit.shortSha ? (
            kpis.latestCommit.githubUrl ? (
              <a
                href={kpis.latestCommit.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="reports-commit-link"
                title="Inspect commit on GitHub"
              >
                <span>{kpis.latestCommit.shortSha}</span>
                <ExternalLink size={12} />
              </a>
            ) : (
              <span className="reports-commit-link" style={{ color: 'var(--color-text-supporting)' }}>
                {kpis.latestCommit.shortSha}
              </span>
            )
          ) : (
            <span style={{ fontSize: 11, color: 'var(--color-text-supporting)', marginTop: 4 }}>
              HEAD revision
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
