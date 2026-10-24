import React, { useMemo, useState } from 'react';
import {
  Folder,
  FolderOpen,
  Search,
  ChevronRight,
  Minimize2,
  Maximize2,
  FolderTree,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import {
  buildFileTree,
  filterTree,
  flattenVisibleTree,
  getFolderColor,
  type TreeNode,
} from './explorerTreeUtils';
import type { ExplorerFileItem } from './explorerTypes';

interface FileTreePanelProps {
  files: ExplorerFileItem[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function FileTreePanel({
  files,
  selectedPath,
  onSelectFile,
  expandedFolders,
  onToggleFolder,
  onExpandAll,
  onCollapseAll,
}: FileTreePanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Build tree structure from files
  const rootTree = useMemo(() => buildFileTree(files), [files]);

  // 2. Filter tree if search active
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return rootTree;
    return filterTree(rootTree, searchQuery) || {
      id: '',
      name: 'root',
      path: '',
      isFolder: true,
      children: [],
      filesCount: 0,
    };
  }, [rootTree, searchQuery]);

  // 3. When searching, auto-expand all folders
  const effectiveExpanded = useMemo(() => {
    if (!searchQuery.trim()) return expandedFolders;
    const all = new Set<string>();
    const gather = (n: TreeNode) => {
      if (n.isFolder) {
        all.add(n.path);
        n.children.forEach(gather);
      }
    };
    gather(filteredTree);
    return all;
  }, [searchQuery, expandedFolders, filteredTree]);

  // 4. Flatten visible rows
  const visibleRows = useMemo(() => {
    return flattenVisibleTree(filteredTree, effectiveExpanded);
  }, [filteredTree, effectiveExpanded]);

  return (
    <aside className="explorer-panel" aria-label="Repository Files">
      <div className="tree-panel-header">
        <h2 className="tree-panel-title">
          <FolderTree size={16} color="#8B78FF" />
          Repository Files
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="viewer-icon-btn"
            title="Expand all folders"
            aria-label="Expand all folders"
            onClick={onExpandAll}
          >
            <Maximize2 size={13} />
          </button>
          <button
            type="button"
            className="viewer-icon-btn"
            title="Collapse all folders"
            aria-label="Collapse all folders"
            onClick={onCollapseAll}
          >
            <Minimize2 size={13} />
          </button>
        </div>
      </div>

      <div className="tree-search-bar">
        <Search size={14} color="#77839C" style={{ flexShrink: 0 }} />
        <input
          type="text"
          className="tree-search-input"
          placeholder="Search files or folders..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Filter repository files"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{ background: 'none', border: 'none', color: '#77839C', cursor: 'pointer', padding: 0 }}
          >
            ✕
          </button>
        )}
      </div>

      <div className="tree-scroll-area" role="tree">
        {visibleRows.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#77839C', fontSize: 12 }}>
            {files.length === 0 ? 'No files in this repository.' : 'No matching files or folders found.'}
          </div>
        ) : (
          visibleRows.map(({ node, depth }) => {
            const isSelected = !node.isFolder && node.path === selectedPath;
            const isExpanded = node.isFolder && effectiveExpanded.has(node.path);
            const folderColor = node.isFolder ? getFolderColor(node.name) : undefined;

            return (
              <div
                key={node.path || node.id || node.name}
                className={`tree-node-row ${isSelected ? 'active' : ''}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onClick={() => {
                  if (node.isFolder) {
                    onToggleFolder(node.path);
                  } else {
                    onSelectFile(node.path);
                  }
                }}
                role="treeitem"
                aria-selected={isSelected}
                aria-expanded={node.isFolder ? isExpanded : undefined}
                title={node.path}
              >
                {node.isFolder ? (
                  <>
                    <span className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}>
                      <ChevronRight size={13} />
                    </span>
                    {isExpanded ? (
                      <FolderOpen size={15} color={folderColor} style={{ flexShrink: 0 }} />
                    ) : (
                      <Folder size={15} color={folderColor} style={{ flexShrink: 0 }} />
                    )}
                  </>
                ) : (
                  <>
                    <span style={{ width: 16, flexShrink: 0 }} />
                    <FileIcon name={node.name} size={15} style={{ flexShrink: 0 }} />
                  </>
                )}

                <span className="tree-node-name">{node.name}</span>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
