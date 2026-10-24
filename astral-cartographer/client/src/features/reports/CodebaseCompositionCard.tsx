import React from 'react';
import type { CodebaseCompositionData } from './reportsTypes';
import { formatCompactNumber } from './reportsCalculation';

interface CodebaseCompositionCardProps {
  composition: CodebaseCompositionData;
  onSelectLanguage?: (lang: string) => void;
}

export function CodebaseCompositionCard({
  composition,
  onSelectLanguage,
}: CodebaseCompositionCardProps) {
  const radius = 50;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;
  const segments = composition.items
    .map((item) => {
      const strokeLength = (item.percentage / 100) * circumference;
      const offset = currentOffset;
      currentOffset += strokeLength;

      return {
        ...item,
        strokeDasharray: `${strokeLength} ${circumference - strokeLength}`,
        strokeDashoffset: -offset,
      };
    })
    .filter((s) => s.percentage > 0);

  return (
    <div className="reports-card" id="section-codebase-composition">
      <div className="reports-card-header">
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">Codebase Composition</h2>
          <span className="reports-card-subtitle">Distribution of languages, file types, and structure.</span>
        </div>
      </div>

      <div className="composition-content">
        {/* SVG Donut */}
        <div className="composition-donut-wrap">
          <svg className="composition-donut-svg" viewBox="0 0 130 130">
            <circle
              cx="65"
              cy="65"
              r={radius}
              stroke="rgba(135, 155, 255, 0.1)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {segments.map((seg) => (
              <circle
                key={seg.name}
                cx="65"
                cy="65"
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={seg.strokeDasharray}
                strokeDashoffset={seg.strokeDashoffset}
                fill="transparent"
                style={{
                  transition: 'stroke-dashoffset 0.6s ease',
                  cursor: onSelectLanguage ? 'pointer' : 'default',
                }}
                onClick={() => onSelectLanguage?.(seg.name)}
              />
            ))}
          </svg>

          <div className="composition-donut-center">
            <span className="composition-donut-total">
              {formatCompactNumber(composition.totalLines)}
            </span>
            <span className="composition-donut-label">Lines of Code</span>
          </div>
        </div>

        {/* Legend List */}
        <div className="composition-legend-list">
          {composition.items.map((item) => (
            <div
              key={item.name}
              className="composition-legend-item"
              onClick={() => onSelectLanguage?.(item.name)}
              style={{ cursor: onSelectLanguage ? 'pointer' : 'default' }}
              title={`${item.name}: ${item.lines.toLocaleString()} lines (${item.files} files)`}
            >
              <div className="composition-legend-left">
                <span className="composition-legend-dot" style={{ background: item.color }} />
                <span style={{ color: 'var(--color-text, #EAF0FF)', fontWeight: 500 }}>
                  {item.name}
                </span>
              </div>
              <span className="composition-legend-percent">{item.percentage}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
