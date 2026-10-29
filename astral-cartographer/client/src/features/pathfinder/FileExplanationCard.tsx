import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Code2,
  Workflow,
  Network,
  Layers,
  Lightbulb,
  CheckCircle,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Compass,
} from 'lucide-react';
import type { FileExplanation } from '../../lib/api';

interface FileExplanationCardProps {
  explanation: FileExplanation;
  repoId: string;
  sourceType?: string;
  isLoading?: boolean;
  onRefreshAi?: () => void;
  onNavigateToFile?: (path: string, line?: number) => void;
}

export function FileExplanationCard({
  explanation,
  repoId,
  sourceType,
  isLoading,
  onRefreshAi,
  onNavigateToFile,
}: FileExplanationCardProps) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'walkthrough' | 'flow' | 'dependencies' | 'role' | 'concepts' | 'quiz'
  >('overview');

  // Quiz interactive state
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});

  const handleSelectOption = (questionId: string, optionIdx: number) => {
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: optionIdx }));
    setRevealedAnswers((prev) => ({ ...prev, [questionId]: true }));
  };

  const { overview, codeWalkthrough, executionFlow, dependencies, architecturalRole, keyConcepts, learningCheck } =
    explanation;

  return (
    <div className="pf-detail card" style={{ padding: 20 }}>
      {/* Header with Title and Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'grid',
              placeItems: 'center',
              color: '#38BDF8',
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#EAF0FF', margin: 0 }}>
                {explanation.filePath.split('/').pop()}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'rgba(139, 120, 255, 0.15)',
                  border: '1px solid rgba(139, 120, 255, 0.3)',
                  color: '#A78BFA',
                  fontWeight: 600,
                }}
              >
                {overview.tier}
              </span>
              {sourceType === 'ai_enriched' && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(52, 211, 153, 0.15)',
                    color: '#34D399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                  title="Enriched with deep AI code analysis"
                >
                  <Sparkles size={10} /> AI Enriched
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#77839C', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              {explanation.filePath}
            </div>
          </div>
        </div>

        {/* Deep Link Buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link
            to={`/explorer?repo=${repoId}&path=${encodeURIComponent(explanation.filePath)}`}
            className="pf-btn"
            style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Open and inspect in Code Explorer"
          >
            <Code2 size={14} color="#6898FF" />
            <span>Open in Code Explorer</span>
          </Link>

          <Link
            to={`/atlas?file=${encodeURIComponent(explanation.filePath)}`}
            className="pf-btn"
            style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            title="View connections in Dependency Atlas"
          >
            <Compass size={14} color="#F472B6" />
            <span>Inspect in Atlas</span>
          </Link>

          {onRefreshAi && (
            <button
              type="button"
              className="pf-btn"
              onClick={onRefreshAi}
              disabled={isLoading}
              style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Sparkles size={14} color="#34D399" />
              <span>{isLoading ? 'Analyzing…' : 'AI Deep Walkthrough'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs for the 7 Sections */}
      <div className="pf-tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          1. Overview
        </button>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'walkthrough' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('walkthrough')}
        >
          2. Walkthrough
        </button>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'flow' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('flow')}
        >
          3. Execution Flow
        </button>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'dependencies' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('dependencies')}
        >
          4. Dependencies
        </button>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'role' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('role')}
        >
          5. Architecture
        </button>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'concepts' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('concepts')}
        >
          6. Concepts
        </button>
        <button
          type="button"
          className={`pf-tab ${activeTab === 'quiz' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('quiz')}
        >
          7. Learning Check
        </button>
      </div>

      {/* Tab Panels */}
      <div style={{ minHeight: 280 }}>
        {/* SECTION 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h3 className="pf-h3">What does this file do?</h3>
              <p className="pf-p" style={{ fontSize: 14, lineHeight: 1.6 }}>
                {overview.purpose}
              </p>
            </div>

            <div>
              <h3 className="pf-h3">Why does it exist?</h3>
              <p className="pf-p" style={{ fontSize: 13, lineHeight: 1.6, color: '#A7B4CC' }}>
                {overview.whyExists}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 6 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: 11, color: '#77839C', display: 'block' }}>Lines of Code</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#EAF0FF' }}>{overview.linesOfCode}</span>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: 11, color: '#77839C', display: 'block' }}>Primary Language</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#38BDF8' }}>{overview.primaryLanguage}</span>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: 11, color: '#77839C', display: 'block' }}>Functions Declared</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#70E8BA' }}>{overview.functionCount}</span>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: 11, color: '#77839C', display: 'block' }}>Exported Symbols</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#FFD166' }}>{overview.exportCount}</span>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: CODE WALKTHROUGH */}
        {activeTab === 'walkthrough' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 className="pf-h3">Logical Sections & Code Walkthrough</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {codeWalkthrough.map((sec, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: 'rgba(3, 7, 18, 0.6)',
                    border: '1px solid rgba(135, 155, 255, 0.15)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, color: '#6898FF', margin: 0 }}>
                      {sec.sectionTitle}
                    </h4>
                    <span style={{ fontSize: 11, color: '#77839C', fontFamily: 'var(--font-mono)' }}>
                      Lines {sec.startLine}{sec.endLine ? `–${sec.endLine}` : ''}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: '#EAF0FF', lineHeight: 1.5, margin: '4px 0 8px 0' }}>
                    {sec.description}
                  </p>
                  {sec.keyItems && sec.keyItems.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#A7B4CC' }}>
                      {sec.keyItems.map((item, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 3: EXECUTION FLOW */}
        {activeTab === 'flow' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h3 className="pf-h3">Execution & Data Flow</h3>
              <p className="pf-p" style={{ fontSize: 13, lineHeight: 1.6 }}>
                {executionFlow.lifecycleSummary}
              </p>
            </div>

            {/* Inflow vs Outflow Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* What calls this code */}
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(3, 7, 18, 0.4)', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                <h4 style={{ fontSize: 13, color: '#38BDF8', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowRight size={14} /> Incoming Callers ({executionFlow.incomingCallers.length})
                </h4>
                {executionFlow.incomingCallers.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#77839C', margin: 0 }}>
                    Root Entry Point — No internal module imports this file directly.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {executionFlow.incomingCallers.map((c, i) => (
                      <div
                        key={i}
                        className="dep-item-row clickable"
                        onClick={() => onNavigateToFile?.(c.callerPath, c.line)}
                        style={{ fontSize: 12, padding: '4px 8px' }}
                      >
                        <span style={{ color: '#EAF0FF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.callerPath.split('/').pop()}
                        </span>
                        <span style={{ color: '#77839C', fontSize: 11 }}>line {c.line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* What this code calls next */}
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(3, 7, 18, 0.4)', border: '1px solid rgba(167, 139, 250, 0.2)' }}>
                <h4 style={{ fontSize: 13, color: '#A78BFA', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowRight size={14} /> Outgoing Calls ({executionFlow.outgoingCalls.length})
                </h4>
                {executionFlow.outgoingCalls.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#77839C', margin: 0 }}>
                    Leaf Module — Does not import other local files.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {executionFlow.outgoingCalls.map((c, i) => (
                      <div
                        key={i}
                        className="dep-item-row clickable"
                        onClick={() => onNavigateToFile?.(c.targetPath, c.line)}
                        style={{ fontSize: 12, padding: '4px 8px' }}
                      >
                        <span style={{ color: '#EAF0FF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.targetPath.split('/').pop()}
                        </span>
                        <span style={{ color: '#77839C', fontSize: 11 }}>line {c.line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: DEPENDENCIES */}
        {activeTab === 'dependencies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 className="pf-h3">Dependencies & External Packages</h3>

            {/* External packages */}
            {dependencies.external && dependencies.external.length > 0 && (
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#77839C', display: 'block', marginBottom: 6 }}>
                  Third-Party Packages ({dependencies.external.length})
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {dependencies.external.map((pkg, idx) => (
                    <span
                      key={idx}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'rgba(255, 209, 102, 0.12)',
                        border: '1px solid rgba(255, 209, 102, 0.3)',
                        color: '#FFD166',
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {pkg}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Internal dependencies */}
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#77839C', display: 'block', marginBottom: 6 }}>
                Internal Connections ({dependencies.internal.length})
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dependencies.internal.map((dep, idx) => (
                  <div
                    key={idx}
                    className="dep-item-row clickable"
                    onClick={() => onNavigateToFile?.(dep.path, dep.line)}
                    style={{ fontSize: 12 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: dep.relation === 'imports' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(167, 139, 250, 0.15)',
                          color: dep.relation === 'imports' ? '#38BDF8' : '#A78BFA',
                        }}
                      >
                        {dep.relation === 'imports' ? 'IMPORTS' : 'USED BY'}
                      </span>
                      <span style={{ color: '#EAF0FF' }}>{dep.path}</span>
                    </div>
                    {dep.line && <span style={{ color: '#77839C', fontSize: 11 }}>line {dep.line}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 5: ARCHITECTURAL ROLE */}
        {activeTab === 'role' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 className="pf-h3">Architectural Role in System</h3>
            <div style={{ padding: 14, borderRadius: 8, background: 'rgba(3, 7, 18, 0.5)', border: '1px solid rgba(135, 155, 255, 0.15)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#EAF0FF', marginBottom: 4 }}>
                Layer: {architecturalRole.layer}
              </div>
              <div style={{ fontSize: 13, color: '#A7B4CC', lineHeight: 1.6, marginBottom: 10 }}>
                {architecturalRole.systemImpact}
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <span style={{ fontSize: 11, color: '#77839C' }}>Connectivity Score</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#6898FF' }}>
                    {architecturalRole.connectivityScore} links
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: '#77839C' }}>Graph Health</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: dependencies.dependencyHealth === 'healthy' ? '#70E8BA' : '#F59E0B' }}>
                    {dependencies.dependencyHealth === 'healthy' ? 'Clean DAG' : dependencies.dependencyHealth}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 6: KEY CONCEPTS */}
        {activeTab === 'concepts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 className="pf-h3">Key Concepts & Programming Patterns</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {keyConcepts.map((kc, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Lightbulb size={16} color="#FFD166" />
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: '#FFD166', margin: 0 }}>
                      {kc.concept}
                    </h4>
                  </div>
                  <p style={{ fontSize: 13, color: '#EAF0FF', lineHeight: 1.5, margin: '2px 0 6px 0' }}>
                    {kc.explanation}
                  </p>
                  <p style={{ fontSize: 12, color: '#77839C', margin: 0, fontStyle: 'italic' }}>
                    In this file: {kc.contextInCode}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 7: LEARNING CHECK */}
        {activeTab === 'quiz' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 className="pf-h3">Learning Check & Comprehension Questions</h3>
            {learningCheck.map((q, idx) => {
              const selected = selectedAnswers[q.id];
              const isRevealed = revealedAnswers[q.id];

              return (
                <div
                  key={q.id || idx}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: 'rgba(3, 7, 18, 0.6)',
                    border: '1px solid rgba(135, 155, 255, 0.15)',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#EAF0FF', marginBottom: 12 }}>
                    {idx + 1}. {q.question}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {q.options.map((opt, optIdx) => {
                      const isCorrect = optIdx === q.correctIndex;
                      const isChosen = selected === optIdx;

                      let bg = 'rgba(255, 255, 255, 0.04)';
                      let border = 'rgba(255, 255, 255, 0.1)';
                      let color = '#EAF0FF';

                      if (isRevealed) {
                        if (isCorrect) {
                          bg = 'rgba(112, 232, 186, 0.15)';
                          border = 'rgba(112, 232, 186, 0.4)';
                          color = '#70E8BA';
                        } else if (isChosen && !isCorrect) {
                          bg = 'rgba(239, 68, 68, 0.15)';
                          border = 'rgba(239, 68, 68, 0.4)';
                          color = '#F87171';
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleSelectOption(q.id, optIdx)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: 6,
                            background: bg,
                            border: `1px solid ${border}`,
                            color,
                            fontSize: 13,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span>{opt}</span>
                          {isRevealed && isCorrect && <CheckCircle size={15} color="#70E8BA" />}
                        </button>
                      );
                    })}
                  </div>

                  {isRevealed && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: selected === q.correctIndex ? 'rgba(112, 232, 186, 0.1)' : 'rgba(255, 173, 102, 0.1)',
                        fontSize: 12,
                        color: selected === q.correctIndex ? '#70E8BA' : '#FFAD66',
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>{selected === q.correctIndex ? '✓ Correct! ' : 'Note: '}</strong>
                      {q.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
