import React, { useState } from 'react';
import {
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Plus,
  Code2,
  AlertCircle,
  FileCode,
  FolderOpen,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import CodeViewer from '../../components/CodeViewer';
import type { ExplorerTab, ExplorerFileItem } from './explorerTypes';

interface SourceViewerPanelProps {
  tabs: ExplorerTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTabClick: () => void;
  currentFile: ExplorerFileItem | null;
  sourceCode: string | null;
  isLoadingSource: boolean;
  sourceError: string | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  targetLine?: number | null;
  targetNonce?: number;
}

export function SourceViewerPanel({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTabClick,
  currentFile,
  sourceCode,
  isLoadingSource,
  sourceError,
  isFullscreen,
  onToggleFullscreen,
  targetLine,
  targetNonce = 0,
}: SourceViewerPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!sourceCode) return;
    navigator.clipboard.writeText(sourceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Language display name and dot color
  const getLanguageInfo = (ext: string = '') => {
    switch (ext.toLowerCase()) {
      case '.ts':
      case '.tsx':
        return { name: 'TypeScript', color: '#38BDF8' };
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return { name: 'JavaScript', color: '#FFB054' };
      case '.java':
        return { name: 'Java', color: '#FF717A' };
      case '.py':
        return { name: 'Python', color: '#43D9A3' };
      case '.go':
        return { name: 'Go', color: '#37D9FF' };
      case '.css':
      case '.scss':
        return { name: 'CSS', color: '#C084FC' };
      case '.json':
        return { name: 'JSON', color: '#FCD34D' };
      case '.md':
      case '.mdx':
        return { name: 'Markdown', color: '#38BDF8' };
      default:
        return { name: currentFile?.language || 'Plain Text', color: '#A7B4CC' };
    }
  };

  const langInfo = getLanguageInfo(currentFile?.ext);

  // Breadcrumb path segments
  const breadcrumbSegments = currentFile ? currentFile.path.split('/') : [];

  return (
    <section className="explorer-panel viewer-panel" aria-label="Source Code Viewer">
      {/* 1. Tab Bar */}
      <div className="viewer-tab-bar" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`viewer-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              role="tab"
              aria-selected={isActive}
              title={tab.path}
            >
              <FileIcon name={tab.name} size={14} style={{ flexShrink: 0 }} />
              <span>{tab.name}</span>
              <button
                type="button"
                className="viewer-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                aria-label={`Close ${tab.name}`}
                title={`Close ${tab.name}`}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="viewer-new-tab-btn"
          onClick={onNewTabClick}
          title="Open another file (Ctrl+P / Search)"
          aria-label="Open another file"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* 2. Subbar: Breadcrumbs + Meta + Actions */}
      {currentFile && (
        <div className="viewer-subbar">
          <div className="viewer-breadcrumb" title={currentFile.path}>
            {breadcrumbSegments.map((segment, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span style={{ color: '#4E5B78', margin: '0 2px' }}>/</span>}
                <span
                  style={{
                    color: index === breadcrumbSegments.length - 1 ? '#EAF0FF' : '#8898B0',
                    fontWeight: index === breadcrumbSegments.length - 1 ? 500 : 400,
                  }}
                >
                  {segment}
                </span>
              </React.Fragment>
            ))}
          </div>

          <div className="viewer-subbar-actions">
            <div className="viewer-lang-badge">
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: langInfo.color,
                  boxShadow: `0 0 6px ${langInfo.color}`,
                }}
              />
              <span>{langInfo.name}</span>
            </div>

            <button
              type="button"
              className="viewer-icon-btn"
              onClick={handleCopy}
              disabled={!sourceCode}
              title={copied ? 'Copied!' : 'Copy source code'}
              aria-label="Copy source code"
            >
              {copied ? <Check size={14} color="#70E8BA" /> : <Copy size={14} />}
            </button>

            <button
              type="button"
              className="viewer-icon-btn"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen editor' : 'Expand source editor'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand source editor'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* 3. Code Content Area */}
      <div className="viewer-code-container">
        {!currentFile ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 32,
              color: '#A7B4CC',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'rgba(56, 107, 255, 0.12)',
                border: '1px solid rgba(100, 160, 255, 0.25)',
                display: 'grid',
                placeItems: 'center',
                color: '#8B78FF',
              }}
            >
              <FolderOpen size={24} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#EAF0FF', marginBottom: 4 }}>
                Select a file to inspect
              </div>
              <div style={{ fontSize: 12, color: '#77839C', maxWidth: 360 }}>
                Choose any file from the Repository Files tree on the left, or use the search bar above to locate functions, classes, or modules.
              </div>
            </div>
          </div>
        ) : isLoadingSource ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: '#8B78FF',
            }}
          >
            <div className="spin" style={{ display: 'grid', placeItems: 'center' }}>
              <Code2 size={24} />
            </div>
            <div style={{ fontSize: 12, color: '#A7B4CC' }}>Loading file source from commit…</div>
          </div>
        ) : sourceError ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <AlertCircle size={28} color="#FFAD66" />
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#F3F6FF', marginBottom: 6 }}>
                Source code preview unavailable
              </div>
              <div style={{ fontSize: 12, color: '#A7B4CC', lineHeight: 1.6 }}>{sourceError}</div>
              <div style={{ fontSize: 11, color: '#77839C', marginTop: 12 }}>
                File metrics, declared functions, and module dependencies remain fully available in the right panel.
              </div>
            </div>
          </div>
        ) : sourceCode !== null ? (
          <div style={{ flex: 1, minHeight: 0, padding: 8 }}>
            <CodeViewer
              code={sourceCode}
              path={currentFile.path}
              target={targetLine ? { line: targetLine, nonce: targetNonce } : null}
              label={`Source of ${currentFile.path}`}
            />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#77839C',
              fontSize: 12,
            }}
          >
            No source content available.
          </div>
        )}
      </div>
    </section>
  );
}
