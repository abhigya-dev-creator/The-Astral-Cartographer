import React from 'react';
import { Folder, Code2, GitFork, Package } from 'lucide-react';
import type { AnalysisDetails, IAnalysisMetrics } from '../../lib/api';
import type { AtlasData } from '../atlas/model';

interface KeyMetricsGridProps {
  analysis: AnalysisDetails | null;
  atlas: AtlasData | null;
}

export function KeyMetricsGrid({ analysis, atlas }: KeyMetricsGridProps) {
  const metrics: IAnalysisMetrics | undefined = analysis?.metrics;

  // 1. Total Files
  const totalFiles = metrics?.totalFiles ?? (analysis?.files ? analysis.files.length : null);
  const codeFiles = metrics?.coverage?.codeFiles ?? totalFiles;
  const analyzedFiles = metrics?.coverage?.analyzedCodeFiles ?? (analysis?.files ? analysis.files.length : null);

  // 2. Functions
  const totalFunctions =
    metrics?.functions !== undefined && metrics?.functions !== null
      ? metrics.functions
      : atlas
      ? atlas.files.reduce((acc, f) => acc + f.functions.length, 0)
      : null;

  // 3. Dependencies
  // Distinguish unique dependencies vs dependency links
  const totalDependencies =
    metrics?.dependencies !== undefined && metrics?.dependencies !== null
      ? metrics.dependencies
      : atlas
      ? atlas.edges.length
      : null;

  const localEdges =
    metrics?.dependencyMetrics?.localDependencies !== undefined
      ? metrics.dependencyMetrics.localDependencies
      : atlas
      ? atlas.edges.length
      : null;

  // 4. External Packages
  const externalPackagesCount =
    metrics?.dependencyMetrics?.externalPackages !== undefined
      ? metrics.dependencyMetrics.externalPackages
      : null;

  return (
    <div className="health-card health-col-4" id="section-key-metrics">
      <div className="health-card-header">
        <h2 className="health-card-title">Key Metrics</h2>
        {metrics?.coverage?.completeness === 'partial' && (
          <span
            style={{
              fontSize: 11,
              color: '#FFD166',
              background: 'rgba(255, 209, 102, 0.1)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
            title="Analysis ran on supported AST languages"
          >
            Partial AST
          </span>
        )}
      </div>

      <div className="key-metrics-grid">
        {/* Metric 1: Total Files */}
        <div
          className="key-metric-tile"
          title={
            codeFiles && analyzedFiles
              ? `Discovered files: ${totalFiles?.toLocaleString() ?? 'N/A'}. Analyzed code files: ${analyzedFiles.toLocaleString()} / ${codeFiles.toLocaleString()}`
              : 'Total repository files'
          }
        >
          <div className="key-metric-icon-wrap" style={{ background: 'rgba(56, 107, 255, 0.18)', color: '#386BFF' }}>
            <Folder size={20} />
          </div>
          <div className="key-metric-details">
            <span className="key-metric-value">
              {totalFiles !== null && totalFiles !== undefined ? totalFiles.toLocaleString() : 'N/A'}
            </span>
            <span className="key-metric-label">Total Files</span>
          </div>
        </div>

        {/* Metric 2: Functions */}
        <div
          className="key-metric-tile"
          title="Total functions and methods detected across analyzed source modules"
        >
          <div className="key-metric-icon-wrap" style={{ background: 'rgba(67, 217, 163, 0.18)', color: '#43D9A3' }}>
            <Code2 size={20} />
          </div>
          <div className="key-metric-details">
            <span className="key-metric-value">
              {totalFunctions !== null && totalFunctions !== undefined
                ? totalFunctions.toLocaleString()
                : metrics?.coverage?.codeFiles === 0
                ? 'N/A'
                : '0'}
            </span>
            <span className="key-metric-label">Functions</span>
          </div>
        </div>

        {/* Metric 3: Dependencies */}
        <div
          className="key-metric-tile"
          title={
            localEdges !== null && localEdges !== undefined
              ? `Total dependency links: ${totalDependencies?.toLocaleString() ?? '0'} (Internal edges: ${localEdges.toLocaleString()})`
              : 'Total module dependency connections'
          }
        >
          <div className="key-metric-icon-wrap" style={{ background: 'rgba(255, 173, 102, 0.18)', color: '#FFAD66' }}>
            <GitFork size={20} />
          </div>
          <div className="key-metric-details">
            <span className="key-metric-value">
              {totalDependencies !== null && totalDependencies !== undefined
                ? totalDependencies.toLocaleString()
                : 'N/A'}
            </span>
            <span className="key-metric-label">Dependencies</span>
          </div>
        </div>

        {/* Metric 4: External Packages */}
        <div
          className="key-metric-tile"
          title="Third-party npm packages referenced in import statements"
        >
          <div className="key-metric-icon-wrap" style={{ background: 'rgba(168, 85, 247, 0.18)', color: '#C084FC' }}>
            <Package size={20} />
          </div>
          <div className="key-metric-details">
            <span className="key-metric-value">
              {externalPackagesCount !== null && externalPackagesCount !== undefined
                ? externalPackagesCount.toLocaleString()
                : 'N/A'}
            </span>
            <span className="key-metric-label">External Packages</span>
          </div>
        </div>
      </div>
    </div>
  );
}
