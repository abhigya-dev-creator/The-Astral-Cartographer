import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { HealthScoreResult } from './healthTypes';

interface HealthScoreCardProps {
  scoreResult: HealthScoreResult;
}

export function HealthScoreCard({ scoreResult }: HealthScoreCardProps) {
  const [showDeductions, setShowDeductions] = useState(false);

  const radius = 48;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;

  const score = scoreResult.score;
  const isAvailable = score !== null;

  // Calculate stroke dash offset
  const progressPercent = isAvailable ? Math.max(0, Math.min(100, score)) : 0;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Gauge color based on status
  let gaugeColor = '#43D9A3';
  if (!isAvailable) {
    gaugeColor = '#77839C';
  } else if (scoreResult.status === 'critical') {
    gaugeColor = '#FF717A';
  } else if (scoreResult.status === 'attention' || scoreResult.status === 'fair' || scoreResult.status === 'good') {
    gaugeColor = score >= 80 ? '#43D9A3' : score >= 65 ? '#FFD166' : '#FFAD66';
  }

  return (
    <div className="health-card health-col-4" id="section-overall-health-score">
      <div className="health-card-header">
        <h2 className="health-card-title">Overall Health Score</h2>
        {scoreResult.deductions.length > 0 && (
          <button
            type="button"
            className="health-card-action-btn"
            onClick={() => setShowDeductions(!showDeductions)}
            title="Inspect scoring factors"
            style={{ fontSize: 11.5 }}
          >
            <span>Factors</span>
            {showDeductions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      <div className="health-score-content">
        {/* Radial gauge */}
        <div className="health-score-gauge-wrap">
          <svg className="health-score-gauge-svg" viewBox="0 0 120 120">
            {/* Background track circle */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              stroke="rgba(135, 155, 255, 0.12)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Progress circle */}
            {isAvailable && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                stroke={gaugeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                style={{
                  transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                  filter: `drop-shadow(0 0 6px ${gaugeColor}66)`,
                }}
              />
            )}
          </svg>

          <div className="health-score-inner-text">
            <span className="health-score-number" style={{ color: isAvailable ? '#F3F6FF' : '#77839C' }}>
              {isAvailable ? score : 'N/A'}
            </span>
            <span
              className="health-score-category"
              style={{ color: isAvailable ? gaugeColor : '#77839C' }}
            >
              {scoreResult.categoryLabel}
            </span>
          </div>
        </div>

        {/* Textual summary */}
        <div className="health-score-info">
          <h3
            className="health-score-headline"
            style={{ color: isAvailable ? gaugeColor : '#77839C' }}
          >
            {scoreResult.headline}
          </h3>
          <p className="health-score-explanation">{scoreResult.explanation}</p>

          {scoreResult.coverageNotice && (
            <div className="health-score-coverage-notice">
              <Info size={13} style={{ display: 'inline', verticalAlign: 'text-top', marginRight: 4 }} />
              {scoreResult.coverageNotice}
            </div>
          )}

          {isAvailable && (
            <div className="health-score-breakdown-dots">
              <div className="health-score-dot-item" title="Files with no detected architectural issues">
                <span className="health-score-dot" style={{ background: '#43D9A3' }} />
                <span>{scoreResult.breakdown.healthyPercent}% Healthy</span>
              </div>
              <div className="health-score-dot-item" title="Files with medium or low warnings">
                <span className="health-score-dot" style={{ background: '#FFD166' }} />
                <span>{scoreResult.breakdown.needsAttentionPercent}% Needs Attention</span>
              </div>
              {scoreResult.breakdown.criticalPercent > 0 && (
                <div className="health-score-dot-item" title="Files with critical or high severity issues">
                  <span className="health-score-dot" style={{ background: '#FF717A' }} />
                  <span>{scoreResult.breakdown.criticalPercent}% Critical</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Deductions accordion */}
      {showDeductions && scoreResult.deductions.length > 0 && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: '1px solid rgba(135, 155, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          }}
        >
          <div style={{ color: 'var(--color-text-supporting)', fontWeight: 600 }}>
            Scoring Deductions (Base: 100):
          </div>
          {scoreResult.deductions.map((d, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span>{d.label}</span>
              <span style={{ color: '#FF717A', fontFamily: 'var(--font-mono)' }}>-{d.points} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
