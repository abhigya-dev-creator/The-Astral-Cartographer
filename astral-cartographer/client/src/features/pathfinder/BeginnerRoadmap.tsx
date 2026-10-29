import React, { useState } from 'react';
import {
  Layers,
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDot,
  FileCode,
  Code2,
  Compass,
  GitFork,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import type { DynamicRoadmapResult, DynamicLearningFile, LearningStage } from '../../lib/api';

interface BeginnerRoadmapProps {
  roadmap: DynamicRoadmapResult;
  selectedFilePath: string | null;
  completedFiles: ReadonlySet<string>;
  onSelectFile: (path: string) => void;
  repoId: string;
}

export function BeginnerRoadmap({
  roadmap,
  selectedFilePath,
  completedFiles,
  onSelectFile,
  repoId,
}: BeginnerRoadmapProps) {
  const [selectedStageId, setSelectedStageId] = useState<number | 'all'>('all');

  const filteredStages =
    selectedStageId === 'all'
      ? roadmap.stages.filter((s) => s.files.length > 0)
      : roadmap.stages.filter((s) => s.id === selectedStageId && s.files.length > 0);

  return (
    <section className="pf-queue card" aria-label="Personalized Learning Roadmap" style={{ padding: 18 }}>
      {/* Header with Title and Counts */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 className="pf-h2" style={{ margin: 0 }}>
            Dynamic Learning Roadmap
          </h2>
          <span style={{ fontSize: 12, color: '#77839C' }}>
            {roadmap.learningFilesCount} files mapped across {roadmap.stages.filter((s) => s.files.length > 0).length} architectural stages
          </span>
        </div>
      </div>

      {/* Stage Pill Filter Bar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setSelectedStageId('all')}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            background: selectedStageId === 'all' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)',
            border: selectedStageId === 'all' ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.1)',
            color: selectedStageId === 'all' ? '#38BDF8' : '#A7B4CC',
          }}
        >
          All Stages ({roadmap.learningFilesCount})
        </button>
        {roadmap.stages.map((stage) => {
          if (stage.files.length === 0) return null;
          const isActive = selectedStageId === stage.id;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setSelectedStageId(stage.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: isActive ? `${stage.color}22` : 'rgba(255, 255, 255, 0.05)',
                border: isActive ? `1px solid ${stage.color}` : '1px solid rgba(255, 255, 255, 0.1)',
                color: isActive ? stage.color : '#A7B4CC',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: stage.color,
                }}
              />
              <span>Stage {stage.id} ({stage.files.length})</span>
            </button>
          );
        })}
      </div>

      {/* Stages List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filteredStages.map((stage) => {
          const completedInStage = stage.files.filter((f) => completedFiles.has(f.path)).length;
          const stagePct = Math.round((completedInStage / stage.files.length) * 100);

          return (
            <div
              key={stage.id}
              style={{
                borderRadius: 8,
                background: 'rgba(3, 7, 18, 0.4)',
                border: `1px solid ${stage.color}33`,
                padding: 12,
              }}
            >
              {/* Stage Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: `${stage.color}22`,
                        color: stage.color,
                        border: `1px solid ${stage.color}44`,
                      }}
                    >
                      Stage {stage.id}
                    </span>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#EAF0FF', margin: 0 }}>
                      {stage.name}
                    </h3>
                  </div>
                  <p style={{ fontSize: 11, color: '#77839C', margin: '2px 0 0 0' }}>
                    {stage.description}
                  </p>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: stage.color }}>
                  {completedInStage}/{stage.files.length} ({stagePct}%)
                </div>
              </div>

              {/* Files in Stage */}
              <ol className="pf-steps" style={{ marginTop: 8 }}>
                {stage.files.map((file, i) => {
                  const isCompleted = completedFiles.has(file.path);
                  const isSelected = file.path === selectedFilePath;

                  let statusText = 'Not Started';
                  if (isCompleted) statusText = 'Completed';
                  else if (isSelected) statusText = 'In Progress';

                  return (
                    <li
                      key={file.path}
                      className={`pf-step ${isSelected ? 'is-selected' : ''} is-${statusText
                        .replace(' ', '-')
                        .toLowerCase()}`}
                    >
                      <span className="pf-step-num" aria-hidden="true" style={{ fontSize: 11 }}>
                        {file.rank}
                      </span>
                      <button
                        type="button"
                        className="pf-step-card"
                        onClick={() => onSelectFile(file.path)}
                        aria-current={isSelected ? 'step' : undefined}
                      >
                        <FileCode size={16} className="pf-step-icon" aria-hidden="true" />
                        <span className="pf-step-text">
                          <span className="pf-step-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{file.name}</span>
                            <span
                              style={{
                                fontSize: 9,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: file.importance === 'Critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                                color: file.importance === 'Critical' ? '#EF4444' : '#38BDF8',
                                fontWeight: 700,
                              }}
                            >
                              {file.importance}
                            </span>
                          </span>
                          <span className="pf-step-path">{file.path}</span>
                          <span className="pf-step-sum" style={{ fontSize: 11, color: '#A7B4CC' }}>
                            {file.rationale}
                          </span>
                          <span style={{ fontSize: 10, color: '#77839C', display: 'flex', gap: 8, marginTop: 2 }}>
                            <span>fan-in: {file.fanIn}</span>
                            <span>fan-out: {file.fanOut}</span>
                            <span>{file.lines} lines</span>
                          </span>
                        </span>
                        <ArrowRight size={15} className="pf-step-go" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}
