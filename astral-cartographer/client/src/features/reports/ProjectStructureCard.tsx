import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectStructureNode } from './reportsTypes';

interface ProjectStructureCardProps {
  nodes: ProjectStructureNode[];
  repoId?: string;
}

export function ProjectStructureCard({ nodes, repoId }: ProjectStructureCardProps) {
  const navigate = useNavigate();

  const handleFolderClick = (node: ProjectStructureNode) => {
    if (!repoId) return;
    const url = `/explorer?repo=${repoId}${node.path ? `&path=${encodeURIComponent(node.path)}` : ''}`;
    navigate(url);
  };

  return (
    <div className="reports-card" id="section-project-structure">
      <div className="reports-card-header">
        <div className="reports-card-title-group">
          <h2 className="reports-card-title">Project Structure</h2>
          <span className="reports-card-subtitle">Overview of folders and files.</span>
        </div>
      </div>

      <div className="structure-treemap-grid">
        {nodes.map((node, idx) => {
          const isMain = idx === 0;

          return (
            <div
              key={node.name}
              className={`treemap-block ${isMain ? 'treemap-block-main' : ''}`}
              style={{
                background: `${node.color}28`,
                borderColor: `${node.color}55`,
              }}
              onClick={() => handleFolderClick(node)}
              title={`${node.name}: ${node.fileCount} files (${node.percentage}%). Click to inspect in Code Explorer.`}
            >
              <span className="treemap-folder-name" style={{ color: '#FFFFFF' }}>
                {node.name}
              </span>
              <span className="treemap-folder-percent">
                ({node.percentage}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
