import React, { useState } from 'react';
import {
  Sparkles,
  FileText,
  AlertTriangle,
  Lightbulb,
  Share2,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RecommendationItem } from './healthTypes';

interface RecommendationsCardProps {
  recommendations: RecommendationItem[];
  repoId?: string;
  onGenerateReport: () => void;
}

export function RecommendationsCard({
  recommendations,
  repoId,
  onGenerateReport,
}: RecommendationsCardProps) {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleFileClick = (e: React.MouseEvent, path: string, line?: number) => {
    e.stopPropagation();
    if (!repoId) return;
    const url = `/explorer?repo=${repoId}&path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`;
    navigate(url);
  };

  const renderIcon = (tone: RecommendationItem['tone']) => {
    switch (tone) {
      case 'red':
        return <AlertTriangle size={18} />;
      case 'amber':
        return <Lightbulb size={18} />;
      case 'blue':
        return <Share2 size={18} />;
      case 'green':
        return <ShieldCheck size={18} />;
    }
  };

  return (
    <div className="health-card health-col-8" id="section-recommendations">
      <div className="health-card-header">
        <h2 className="health-card-title">
          <Sparkles size={18} color="#FFD166" />
          <span>AI Insights & Recommendations</span>
        </h2>
        <button
          type="button"
          className="recommendations-header-btn"
          onClick={onGenerateReport}
          title="Export detailed markdown architectural health report"
        >
          <FileText size={14} />
          <span>Generate Full Report</span>
        </button>
      </div>

      <div className="recommendations-list">
        {recommendations.length > 0 ? (
          recommendations.map((rec) => {
            const isExpanded = expandedId === rec.id;

            return (
              <div
                key={rec.id}
                className={`recommendation-card-item ${isExpanded ? 'expanded' : ''}`}
                onClick={() => toggleExpand(rec.id)}
              >
                <div className="recommendation-item-summary-row">
                  <div className="recommendation-item-left">
                    <div className={`recommendation-icon-box ${rec.tone}`}>
                      {renderIcon(rec.tone)}
                    </div>
                    <div className="recommendation-text-group">
                      <div className="recommendation-title">{rec.title}</div>
                      <div className="recommendation-subtitle">{rec.subtitle}</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="recommendation-arrow" />
                </div>

                {isExpanded && (
                  <div className="recommendation-details-pane" onClick={(e) => e.stopPropagation()}>
                    {/* Why it matters */}
                    <div className="rec-detail-section">
                      <span className="rec-detail-label">Why this matters:</span>
                      <p style={{ margin: 0, color: 'var(--color-text)' }}>{rec.whyItMatters}</p>
                    </div>

                    {/* Supporting Evidence */}
                    <div className="rec-detail-section">
                      <span className="rec-detail-label">Supporting Evidence ({rec.confidence}):</span>
                      <ul style={{ margin: '2px 0 0', paddingLeft: 16, color: 'var(--color-text-supporting)' }}>
                        {rec.evidence.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Supporting Files */}
                    {rec.supportingFiles.length > 0 && (
                      <div className="rec-detail-section">
                        <span className="rec-detail-label">Affected Modules:</span>
                        <div className="rec-files-pill-list">
                          {rec.supportingFiles.map((sf, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="rec-file-pill"
                              onClick={(e) => handleFileClick(e, sf.path, sf.line)}
                              title="Inspect file in Code Explorer"
                            >
                              <span>{sf.path}{sf.line ? `:${sf.line}` : ''}</span>
                              <ExternalLink size={10} style={{ marginLeft: 3, verticalAlign: 'middle' }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Practical Next Steps */}
                    <div className="rec-detail-section">
                      <span className="rec-detail-label">Practical Next Steps:</span>
                      <ul style={{ margin: '2px 0 0', paddingLeft: 16, color: '#A99AFF' }}>
                        {rec.nextSteps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--color-text-supporting)',
              fontSize: 13,
            }}
          >
            No recommendations generated. Analysis data unavailable or repository is unanalyzed.
          </div>
        )}
      </div>
    </div>
  );
}
