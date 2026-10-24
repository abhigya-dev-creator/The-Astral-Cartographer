import React, { useMemo, useState } from 'react';
import { History, TrendingUp } from 'lucide-react';
import type { HistoricalTrendPoint } from './healthTypes';

interface MaintainabilityTrendsCardProps {
  trendPoints: HistoricalTrendPoint[];
}

export function MaintainabilityTrendsCard({ trendPoints }: MaintainabilityTrendsCardProps) {
  const [range, setRange] = useState<'all' | '6m' | '30d'>('6m');

  const filteredPoints = useMemo(() => {
    if (!trendPoints || trendPoints.length === 0) return [];
    if (range === 'all') return trendPoints;

    const now = Date.now();
    const msLimit = range === '30d' ? 30 * 86400000 : 180 * 86400000;
    return trendPoints.filter((p) => {
      const t = new Date(p.date).getTime();
      return now - t <= msLimit;
    });
  }, [trendPoints, range]);

  const hasHistoricalData = filteredPoints.length >= 2;

  // Chart dimensions
  const width = 360;
  const height = 120;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Compute SVG points
  const pointsString = useMemo(() => {
    if (!hasHistoricalData) return '';
    return filteredPoints
      .map((p, idx) => {
        const x = padLeft + (idx / (filteredPoints.length - 1)) * chartW;
        const normalizedY = Math.max(0, Math.min(100, p.healthScore));
        const y = padTop + chartH - (normalizedY / 100) * chartH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [filteredPoints, hasHistoricalData, chartW, chartH]);

  const areaString = useMemo(() => {
    if (!hasHistoricalData || !pointsString) return '';
    const firstX = padLeft;
    const lastX = padLeft + chartW;
    const bottomY = padTop + chartH;
    return `${firstX},${bottomY} ${pointsString} ${lastX},${bottomY}`;
  }, [hasHistoricalData, pointsString, chartW, chartH]);

  return (
    <div className="health-card health-col-4" id="section-maintainability-trends">
      <div className="health-card-header">
        <h2 className="health-card-title">Maintainability Trends</h2>
        {hasHistoricalData && (
          <select
            className="trends-range-select"
            value={range}
            onChange={(e) => setRange(e.target.value as any)}
            aria-label="Time range selector"
          >
            <option value="30d">Last 30 days</option>
            <option value="6m">Last 6 months</option>
            <option value="all">All time</option>
          </select>
        )}
      </div>

      {hasHistoricalData ? (
        <div className="trends-chart-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#386BFF" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#386BFF" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            {[0, 25, 50, 75, 100].map((v) => {
              const y = padTop + chartH - (v / 100) * chartH;
              return (
                <g key={v}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={padLeft + chartW}
                    y2={y}
                    stroke="rgba(135, 155, 255, 0.08)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft - 6}
                    y={y + 3}
                    textAnchor="end"
                    fill="var(--color-text-supporting, #A7B4CC)"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                  >
                    {v}
                  </text>
                </g>
              );
            })}

            {/* Gradient Area */}
            <polygon points={areaString} fill="url(#trendGradient)" />

            {/* Line curve */}
            <polyline
              points={pointsString}
              fill="none"
              stroke="#3884FF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 6px rgba(56, 132, 255, 0.6))' }}
            />

            {/* Data point dots and labels */}
            {filteredPoints.map((p, idx) => {
              const x = padLeft + (idx / (filteredPoints.length - 1)) * chartW;
              const y = padTop + chartH - (p.healthScore / 100) * chartH;
              return (
                <g key={p.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r="4"
                    fill="#F3F6FF"
                    stroke="#3884FF"
                    strokeWidth="2"
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{`${p.label}: Score ${p.healthScore} (${p.issuesCount} issues)`}</title>
                  </circle>
                  <text
                    x={x}
                    y={padTop + chartH + 16}
                    textAnchor="middle"
                    fill="var(--color-text-supporting, #A7B4CC)"
                    fontSize="9.5"
                  >
                    {p.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="trends-empty-state">
          <History size={26} color="#77839C" style={{ marginBottom: 6 }} />
          <div className="trends-empty-title">Historical Trends Unavailable</div>
          <div className="trends-empty-desc">
            Trend tracking requires at least 2 historical snapshots. Analysis data from future commits and runs will map health progression over time here.
          </div>
        </div>
      )}
    </div>
  );
}
