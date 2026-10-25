import React from 'react';
import { ArrowRight, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RiskItem } from './healthTypes';

interface TopRiskAreasCardProps {
  risks: RiskItem[];
  repoId?: string;
  onViewAll: () => void;
}

export function TopRiskAreasCard({ risks, repoId, onViewAll }: TopRiskAreasCardProps) {
  const navigate = useNavigate();
  const topRisks = risks.slice(0, 5);

  const handleFileClick = (item: RiskItem) => {
    if (!repoId) return;
    const url = `/explorer?repo=${repoId}&path=${encodeURIComponent(item.filePath)}${
      item.line ? `&line=${item.line}` : ''
    }`;
    navigate(url);
  };

  return (
    <div className="health-card health-col-4" id="section-top-risk-areas">
      <div className="health-card-header">
        <h2 className="health-card-title">Top Risk Areas</h2>
        <button
          type="button"
          className="health-card-action-btn"
          onClick={onViewAll}
          title="Inspect all repository risk items"
        >
          <span>View All</span>
          <ArrowRight size={14} />
        </button>
      </div>

      <div className="risk-items-list">
        {topRisks.length > 0 ? (
          topRisks.map((item) => (
            <div
              key={item.id}
              className="risk-item-row"
              onClick={() => handleFileClick(item)}
              title={`${item.title}: ${item.description}. Click to inspect in Code Explorer.`}
            >
              <div className="risk-item-left">
                <FileText size={15} color="#7DD3FC" style={{ flexShrink: 0 }} />
                <span className="risk-item-path">{item.filePath}</span>
              </div>

              <span className={`risk-severity-badge ${item.severity}`}>
                {item.severity}
              </span>
            </div>
          ))
        ) : (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--color-text-supporting)',
              fontSize: 12.5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CheckCircle2 size={24} color="#43D9A3" />
            <span>No critical architectural risks detected in analyzed files.</span>
          </div>
        )}
      </div>

      {topRisks.length > 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            color: 'var(--color-text-supporting)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Click any file to inspect in Code Explorer</span>
          <span>{risks.length.toLocaleString()} total flagged</span>
        </div>
      )}
    </div>
  );
}
