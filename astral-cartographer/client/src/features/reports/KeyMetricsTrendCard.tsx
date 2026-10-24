import React, { useState } from 'react';
import { Code2, GitFork, AlertTriangle, FileCode, CheckCircle2 } from 'lucide-react';
import type { KeyMetricSeriesItem } from './reportsTypes';

interface KeyMetricsTrendCardProps {
  metrics: KeyMetricSeriesItem[];
}

export function KeyMetricsTrendCard({ metrics }: KeyMetricsTrendCardProps) {
  const [timeRange, setTimeRange] = useState('6m');

  const renderIcon = (name: string, color: string) => {
    switch (name) {
      case 'functions':
        return <Code2 size={16} color={color} />;
      case 'dependencies':
        return <GitFork size={16} color={color} />;
      case 'issues_opened':
        return <AlertTriangle size={16} color={color} />;
      case 'commits':
      default:
        return <FileCode size={16} color={color} />;
    }
  };

  const renderSparkline = (points: number[], color: string) => {
    if (!points || points.length < 2) return null;
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const range = Math.max(1, max - min);
    const w = 72;
    const h = 20;

    const pathData = points
      .map((p, idx) => {
        const x = (idx / (points.length - 1)) * w;
        const y = h - ((p - min) / range) * (h - 4) - 2;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg className="key-metric-sparkline-svg" viewBox={`0 0 ${w} ${h}`}>
        <path
          d={pathData}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div className="reports-card" id="section-key-metrics-trends">
      <div className="reports-card-header">
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">Key Metrics</h2>
          <span className="reports-card-subtitle">Verified structural codebase metrics.</span>
        </div>
        <select
          className="trends-range-select"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          aria-label="Metrics time range"
        >
          <option value="6m">Last 6 Months</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="key-metrics-list">
        {metrics.map((item) => (
          <div key={item.id} className="key-metric-row" title={`${item.label}: ${item.sourceNote}`}>
            <div className="key-metric-left">
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: `${item.color}22`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {renderIcon(item.iconName, item.color)}
              </div>
              <span className="key-metric-title">{item.label}</span>
            </div>

            <div className="key-metric-right">
              <span className="key-metric-stat">{item.value}</span>
              {renderSparkline(item.sparkline, item.color)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
