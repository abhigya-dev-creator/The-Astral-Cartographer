import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Lightbulb, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ReportInsightItem } from './reportsTypes';

interface InsightsListCardProps {
  insights: ReportInsightItem[];
  onViewAll?: () => void;
}

export function InsightsListCard({ insights, onViewAll }: InsightsListCardProps) {
  const navigate = useNavigate();

  const renderIcon = (type: ReportInsightItem['type']) => {
    switch (type) {
      case 'positive':
        return <CheckCircle2 size={16} color="#43D9A3" />;
      case 'warning':
        return <AlertTriangle size={16} color="#FFAD66" />;
      case 'critical':
        return <AlertCircle size={16} color="#FF717A" />;
      case 'suggestion':
      default:
        return <Lightbulb size={16} color="#38BDF8" />;
    }
  };

  const handleInsightClick = (item: ReportInsightItem) => {
    if (item.linkTo) {
      navigate(item.linkTo);
    }
  };

  return (
    <div className="reports-card" id="section-insights-recommendations">
      <div className="reports-card-header">
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">Insights & Recommendations</h2>
          <span className="reports-card-subtitle">Key findings based on structural and community analysis.</span>
        </div>
        <button
          type="button"
          className="health-card-action-btn"
          onClick={onViewAll}
          style={{ fontSize: 12.5 }}
        >
          <span>View All</span>
          <ArrowRight size={14} />
        </button>
      </div>

      <div className="insights-list">
        {insights.map((item) => (
          <div
            key={item.id}
            className="insight-card-item"
            onClick={() => handleInsightClick(item)}
            title={`${item.whyItMatters} Click to ${item.linkLabel || 'inspect'}.`}
            style={{ cursor: item.linkTo ? 'pointer' : 'default' }}
          >
            <div className="insight-item-left">
              <div
                className="insight-icon-wrap"
                style={{
                  background:
                    item.type === 'positive'
                      ? 'rgba(67, 217, 163, 0.15)'
                      : item.type === 'warning'
                      ? 'rgba(255, 173, 102, 0.15)'
                      : item.type === 'critical'
                      ? 'rgba(255, 113, 122, 0.15)'
                      : 'rgba(56, 189, 248, 0.15)',
                }}
              >
                {renderIcon(item.type)}
              </div>
              <div className="insight-text-group">
                <div className="insight-title">{item.title}</div>
                <div className="insight-description">{item.description}</div>
              </div>
            </div>

            <span className={`insight-badge ${item.type}`}>
              {item.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
