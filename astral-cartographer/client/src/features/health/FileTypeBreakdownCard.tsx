import React from 'react';
import { Info } from 'lucide-react';
import type { AnalysisDetails, IAnalysisLanguage } from '../../lib/api';

interface FileTypeBreakdownCardProps {
  analysis: AnalysisDetails | null;
  onSelectLanguage?: (language: string) => void;
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#38BDF8',
  javascript: '#FFD166',
  tsx: '#C084FC',
  jsx: '#F472B6',
  css: '#FB7185',
  scss: '#F43F5E',
  html: '#FB923C',
  json: '#34D399',
  markdown: '#94A3B8',
  java: '#F97316',
  python: '#60A5FA',
  other: '#64748B',
};

interface ProcessedLanguageItem {
  name: string;
  files: number;
  percentage: number;
  color: string;
  supported: boolean;
}

export function FileTypeBreakdownCard({
  analysis,
  onSelectLanguage,
}: FileTypeBreakdownCardProps) {
  const languages: IAnalysisLanguage[] = analysis?.languages || [];
  const totalDiscovered = analysis?.metrics?.totalFiles || 0;
  const analyzedCount = analysis?.metrics?.coverage?.analyzedCodeFiles ?? analysis?.files?.length ?? 0;

  // Process languages and colors
  const totalLangFiles = languages.reduce((sum: number, l: IAnalysisLanguage) => sum + (l.count || 0), 0);
  const totalCount = totalDiscovered > 0 ? totalDiscovered : totalLangFiles;

  // Build items with colors
  const items: ProcessedLanguageItem[] = languages.map((l: IAnalysisLanguage) => {
    const key = l.name.toLowerCase();
    const color = LANGUAGE_COLORS[key] || LANGUAGE_COLORS.other;
    const pct = l.percentage !== undefined ? Math.round(l.percentage) : (totalCount > 0 ? Math.round((l.count / totalCount) * 100) : 0);
    return {
      name: l.name,
      files: l.count,
      percentage: pct,
      color,
      supported: l.support === 'full' || ['javascript', 'typescript', 'java'].includes(key),
    };
  });

  // SVG Donut calculation
  const radius = 48;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;
  const segments = items
    .map((item: ProcessedLanguageItem) => {
      const fraction = totalCount > 0 ? item.files / totalCount : 0;
      const strokeLength = fraction * circumference;
      const offset = currentOffset;
      currentOffset += strokeLength;

      return {
        ...item,
        strokeDasharray: `${strokeLength} ${circumference - strokeLength}`,
        strokeDashoffset: -offset,
      };
    })
    .filter((s) => s.files > 0);

  return (
    <div className="health-card health-col-4" id="section-file-type-breakdown">
      <div className="health-card-header">
        <h2 className="health-card-title">File Type Breakdown</h2>
        {analyzedCount > 0 && totalCount > 0 && (
          <span
            style={{
              fontSize: 10.5,
              color: 'var(--color-text-supporting)',
              fontFamily: 'var(--font-mono)',
            }}
            title={`Analyzed: ${analyzedCount.toLocaleString()} source modules of ${totalCount.toLocaleString()} total files`}
          >
            {Math.round((analyzedCount / totalCount) * 100)}% AST coverage
          </span>
        )}
      </div>

      <div className="filetype-content">
        {/* SVG Donut */}
        <div className="filetype-donut-wrap">
          <svg className="filetype-donut-svg" viewBox="0 0 124 124">
            <circle
              cx="62"
              cy="62"
              r={radius}
              stroke="rgba(135, 155, 255, 0.1)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {segments.map((seg) => (
              <circle
                key={seg.name}
                cx="62"
                cy="62"
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={seg.strokeDasharray}
                strokeDashoffset={seg.strokeDashoffset}
                fill="transparent"
                style={{
                  transition: 'stroke-dashoffset 0.6s ease, stroke-dasharray 0.6s ease',
                  cursor: onSelectLanguage ? 'pointer' : 'default',
                }}
                onClick={() => onSelectLanguage?.(seg.name)}
              />
            ))}
          </svg>

          <div className="filetype-donut-center" title={`Total files: ${totalCount.toLocaleString()}`}>
            <span className="filetype-donut-total">
              {totalCount >= 10000
                ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(totalCount)
                : totalCount > 0
                ? totalCount.toLocaleString()
                : '0'}
            </span>
            <span className="filetype-donut-label">Files</span>
          </div>
        </div>

        {/* Legend */}
        <div className="filetype-legend-list">
          {items.map((item: ProcessedLanguageItem) => (
            <div
              key={item.name}
              className="filetype-legend-item"
              onClick={() => onSelectLanguage?.(item.name)}
              style={{ cursor: onSelectLanguage ? 'pointer' : 'default' }}
              title={`${item.name}: ${item.files.toLocaleString()} files (${item.percentage}%)${
                item.supported ? ' - Full AST analysis supported' : ' - Partial/Regex analysis'
              }`}
            >
              <div className="filetype-legend-left">
                <span className="filetype-legend-dot" style={{ background: item.color }} />
                <span className="filetype-legend-name">{item.name}</span>
              </div>
              <span className="filetype-legend-percent">{item.percentage}%</span>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--color-text-supporting)' }}>
              No language metadata available.
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid rgba(135, 155, 255, 0.08)',
          fontSize: 10.5,
          color: 'var(--color-text-supporting)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: 0.85,
        }}
      >
        <Info size={11} style={{ flexShrink: 0 }} />
        <span>AST parsing active for JS/TS/Java. Non-code files are classified by extension.</span>
      </div>
    </div>
  );
}
