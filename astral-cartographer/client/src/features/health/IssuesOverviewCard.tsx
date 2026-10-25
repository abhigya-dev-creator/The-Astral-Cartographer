import React from 'react';
import type { SeverityCategoryInfo, SeverityLevel } from './healthTypes';

interface IssuesOverviewCardProps {
  categories: Record<SeverityLevel, SeverityCategoryInfo>;
  onSelectSeverity: (severity: SeverityLevel) => void;
}

export function IssuesOverviewCard({
  categories,
  onSelectSeverity,
}: IssuesOverviewCardProps) {
  const levels: SeverityLevel[] = ['critical', 'high', 'medium', 'low'];
  const totalIssues = levels.reduce((acc, lvl) => acc + categories[lvl].count, 0);

  // SVG donut calculation
  const radius = 48;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;
  const segments = levels
    .map((lvl) => {
      const count = categories[lvl].count;
      const fraction = totalIssues > 0 ? count / totalIssues : 0;
      const strokeLength = fraction * circumference;
      const offset = currentOffset;
      currentOffset += strokeLength;

      return {
        level: lvl,
        count,
        color: categories[lvl].color,
        strokeDasharray: `${strokeLength} ${circumference - strokeLength}`,
        strokeDashoffset: -offset,
      };
    })
    .filter((s) => s.count > 0);

  return (
    <div className="health-card health-col-4" id="section-issues-overview">
      <div className="health-card-header">
        <h2 className="health-card-title">Issues Overview</h2>
        {totalIssues > 0 && (
          <button
            type="button"
            className="health-card-action-btn"
            onClick={() => onSelectSeverity('critical')}
            style={{ fontSize: 11.5 }}
          >
            Inspect
          </button>
        )}
      </div>

      <div className="issues-overview-content">
        {/* SVG Donut */}
        <div className="issues-donut-wrap">
          <svg className="issues-donut-svg" viewBox="0 0 124 124">
            {/* Background ring */}
            <circle
              cx="62"
              cy="62"
              r={radius}
              stroke="rgba(135, 155, 255, 0.1)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Colored segments */}
            {segments.map((seg) => (
              <circle
                key={seg.level}
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
                  cursor: 'pointer',
                }}
                onClick={() => onSelectSeverity(seg.level)}
              />
            ))}
          </svg>

          <div className="issues-donut-center" title={`Total issues: ${totalIssues.toLocaleString()}`}>
            <span className="issues-donut-total">
              {totalIssues >= 10000
                ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(totalIssues)
                : totalIssues.toLocaleString()}
            </span>
            <span className="issues-donut-label">Issues Found</span>
          </div>
        </div>

        {/* Legend */}
        <div className="issues-legend-list">
          {levels.map((lvl) => {
            const cat = categories[lvl];
            const count = cat?.count ?? 0;
            return (
              <button
                key={lvl}
                type="button"
                className="issues-legend-item"
                onClick={() => onSelectSeverity(lvl)}
                title={`Click to inspect ${count.toLocaleString()} ${cat?.label || lvl} issues`}
              >
                <div className="issues-legend-left">
                  <span className="issues-legend-dot" style={{ background: cat?.dotColor || '#77839C' }} />
                  <span className="issues-legend-name">{cat?.label || lvl}</span>
                </div>
                <span className="issues-legend-count">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
