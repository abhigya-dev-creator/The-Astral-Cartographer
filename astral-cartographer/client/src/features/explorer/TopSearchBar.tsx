import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Folder, Zap, Box, Tag } from 'lucide-react';
import { FileIcon } from './FileIcon';
import type { ExplorerFileItem, SearchItem } from './explorerTypes';

interface TopSearchBarProps {
  files: ExplorerFileItem[];
  onSelectResult: (path: string, line?: number) => void;
}

export function TopSearchBar({ files, onSelectResult }: TopSearchBarProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. Build index of files, functions, classes, and exports
  const searchIndex = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];
    const seenFolders = new Set<string>();

    for (const f of files) {
      // Add file
      items.push({
        id: `file:${f.path}`,
        kind: 'file',
        title: f.name,
        subtitle: f.path,
        path: f.path,
        badge: f.language || 'file',
      });

      // Add folder
      if (f.folder && !seenFolders.has(f.folder)) {
        seenFolders.add(f.folder);
        items.push({
          id: `folder:${f.folder}`,
          kind: 'folder',
          title: f.folder.split('/').pop() || f.folder,
          subtitle: f.folder,
          path: f.path, // opens first file in folder
          badge: 'folder',
        });
      }

      // Add functions
      for (const fn of f.functions) {
        items.push({
          id: `fn:${f.path}:${fn.name}:${fn.line}`,
          kind: fn.kind === 'class' ? 'class' : 'function',
          title: fn.name,
          subtitle: `${f.path}:${fn.line}`,
          path: f.path,
          line: fn.line,
          badge: fn.kind,
        });
      }

      // Add exports
      for (const exp of f.exports) {
        const expName = typeof exp === 'string' ? exp : exp.name;
        const expLine = typeof exp === 'string' ? undefined : exp.line;
        const expKind = typeof exp === 'string' ? 'export' : exp.kind || 'export';
        if (expName && !f.functions.some((fn) => fn.name === expName)) {
          items.push({
            id: `exp:${f.path}:${expName}:${expLine || ''}`,
            kind: 'export',
            title: expName,
            subtitle: `${f.path}${expLine ? `:${expLine}` : ''}`,
            path: f.path,
            line: expLine,
            badge: expKind,
          });
        }
      }
    }

    return items;
  }, [files]);

  // 2. Filter query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: Array<{ item: SearchItem; rank: number }> = [];

    for (const item of searchIndex) {
      const titleLower = item.title.toLowerCase();
      const subLower = item.subtitle.toLowerCase();

      let rank = -1;
      if (titleLower === q) rank = 0;
      else if (titleLower.startsWith(q)) rank = 1;
      else if (titleLower.includes(q)) rank = 2;
      else if (subLower.includes(q)) rank = 3;

      if (rank >= 0) {
        hits.push({ item, rank });
      }
    }

    hits.sort((a, b) => a.rank - b.rank || a.item.title.length - b.item.title.length);
    return hits.slice(0, 15).map((h) => h.item);
  }, [searchIndex, query]);

  // Global keybinding Ctrl+K / / to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Arrow key navigation inside dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[selectedIndex];
      if (pick) {
        onSelectResult(pick.path, pick.line);
        setIsOpen(false);
        setQuery('');
      }
    }
  };

  const getItemIcon = (kind: SearchItem['kind'], title: string) => {
    switch (kind) {
      case 'file':
        return <FileIcon name={title} size={15} style={{ flexShrink: 0 }} />;
      case 'folder':
        return <Folder size={15} color="#FFB054" style={{ flexShrink: 0 }} />;
      case 'function':
        return <Zap size={15} color="#8EB5FF" style={{ flexShrink: 0 }} />;
      case 'class':
        return <Box size={15} color="#37D9FF" style={{ flexShrink: 0 }} />;
      case 'export':
        return <Tag size={15} color="#A99AFF" style={{ flexShrink: 0 }} />;
    }
  };

  return (
    <div className="explorer-search-wrapper" ref={containerRef}>
      <div className="explorer-search-bar">
        <Search size={15} color="#77839C" style={{ flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          className="explorer-search-input"
          placeholder="Search files, functions, or symbols..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="Search files, functions, or symbols"
        />
        <kbd className="explorer-search-kbd">⌘K</kbd>
      </div>

      {isOpen && query.trim().length > 0 && (
        <div className="search-results-dropdown" role="listbox">
          {filtered.length === 0 ? (
            <div style={{ padding: '16px 12px', textAlign: 'center', color: '#77839C', fontSize: 12 }}>
              No symbols, functions, or files found matching &quot;{query}&quot;.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id}
                className={`search-result-row ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  onSelectResult(item.path, item.line);
                  setIsOpen(false);
                  setQuery('');
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                role="option"
                aria-selected={idx === selectedIndex}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                  {getItemIcon(item.kind, item.title)}
                  <div className="search-result-info">
                    <span className="search-result-title">{item.title}</span>
                    <span className="search-result-sub">{item.subtitle}</span>
                  </div>
                </div>
                {item.badge && (
                  <span
                    style={{
                      fontSize: 10,
                      color: '#8EB5FF',
                      background: 'rgba(56, 107, 255, 0.12)',
                      padding: '1px 6px',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
