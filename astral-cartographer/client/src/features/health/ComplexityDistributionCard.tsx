import React from 'react';
import { Info } from 'lucide-react';
import type { ComplexityBucket } from './healthTypes';

interface ComplexityDistributionCardProps {
  buckets: ComplexityBucket[];
  onSelectBucket: (bucket: ComplexityBucket) => void;
}

export function ComplexityDistributionCard({
  buckets,
  onSelectBucket,
}: ComplexityDistributionCardProps) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const totalFilesEvaluated = buckets.reduce((acc, b) => acc + b.count, 0);

  // Format count for Y-axis or header
  const formatCount = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="health-card health-col-4" id="section-complexity-distribution">
      <div className="health-card-header">
        <h2 className="health-card-title">Complexity Distribution</h2>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-supporting)',
            fontFamily: 'var(--font-mono)',
          }}
          title="Distribution based on cyclomatic complexity decision branches or function count"
        >
          {totalFilesEvaluated > 0 ? `${totalFilesEvaluated.toLocaleString()} modules` : 'N/A'}
        </span>
      </div>

      <div className="complexity-chart-wrap">
        {buckets.map((bucket) => {
          const heightPercent = Math.max(8, Math.round((bucket.count / maxCount) * 100));

          return (
            <div
              key={bucket.label}
              className="complexity-bar-col"
              onClick={() => onSelectBucket(bucket)}
              title={`${bucket.label} (${bucket.range}): ${bucket.count.toLocaleString()} files. Click to inspect.`}
            >
              <div className="complexity-bar-track">
                <div
                  className="complexity-bar-fill"
                  style={{
                    height: `${heightPercent}%`,
                    background: bucket.color,
                    boxShadow: `0 0 10px ${bucket.color}44`,
                  }}
                />
                <div className="complexity-bar-count-tooltip">
                  {bucket.count.toLocaleString()}
                </div>
              </div>

              <div className="complexity-bar-label">
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{bucket.label}</div>
                <div style={{ fontSize: 9.5, opacity: 0.7 }}>{bucket.range}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 10.5,
          color: 'var(--color-text-supporting)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: 0.85,
        }}
      >
        <Info size={11} />
        <span>Metric: AST cyclomatic decision points (or function count fallback).</span>
      </div>
    </div>
  );
}
