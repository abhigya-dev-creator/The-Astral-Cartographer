import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Archive, Plus, Search } from 'lucide-react';
import { GithubIcon } from '../../components/home/ui';
import type { RepositorySummary } from '../../lib/api';

interface RepoSelectorDropdownProps {
  repositories: RepositorySummary[];
  selectedRepo: RepositorySummary | null;
  onSelectRepo: (repo: RepositorySummary) => void;
}

export function RepoSelectorDropdown({
  repositories,
  selectedRepo,
  onSelectRepo,
}: RepoSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const filtered = repositories.filter((r) => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.owner.toLowerCase().includes(q) ||
      (r.fullName && r.fullName.toLowerCase().includes(q))
    );
  });

  const displayName = selectedRepo
    ? `${selectedRepo.owner} / ${selectedRepo.name}`
    : 'Select Repository';

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <button
        type="button"
        className="explorer-repo-select-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        title={selectedRepo?.fullName || displayName}
      >
        {selectedRepo?.source === 'zip' ? (
          <Archive size={16} color="#FFB054" style={{ flexShrink: 0 }} />
        ) : (
          <GithubIcon size={16} />
        )}
        <span
          style={{
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </span>
        <ChevronDown size={14} color="#77839C" style={{ flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div className="explorer-repo-dropdown-menu" role="listbox">
          {repositories.length > 5 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(4, 8, 19, 0.7)',
                border: '1px solid rgba(135, 155, 255, 0.15)',
                borderRadius: 8,
                padding: '0 10px',
                height: 32,
              }}
            >
              <Search size={13} color="#77839C" />
              <input
                type="text"
                placeholder="Filter repositories..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                style={{
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#EAF0FF',
                  fontSize: 12,
                  width: '100%',
                }}
              />
            </div>
          )}

          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 8px', textAlign: 'center', color: '#77839C', fontSize: 12 }}>
                No repositories found.
              </div>
            ) : (
              filtered.map((repo) => {
                const isSelected = selectedRepo?._id === repo._id;
                return (
                  <div
                    key={repo._id}
                    onClick={() => {
                      onSelectRepo(repo);
                      setIsOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isSelected ? 'rgba(56, 107, 255, 0.2)' : 'transparent',
                      border: isSelected ? '1px solid rgba(100, 160, 255, 0.35)' : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'rgba(56, 107, 255, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      {repo.source === 'zip' ? (
                        <Archive size={14} color="#FFB054" style={{ flexShrink: 0 }} />
                      ) : (
                        <GithubIcon size={14} />
                      )}
                      <div style={{ overflow: 'hidden' }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: '#EAF0FF',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                          }}
                        >
                          {repo.owner} / {repo.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#77839C' }}>
                          {repo.primaryLanguage || 'Unknown'} · {repo.fileCount || 0} files
                        </div>
                      </div>
                    </div>

                    {isSelected && <Check size={14} color="#6898FF" style={{ flexShrink: 0 }} />}
                  </div>
                );
              })
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(135, 155, 255, 0.12)',
              paddingTop: 8,
              marginTop: 4,
            }}
          >
            <a
              href="/home"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: '#8B78FF',
                padding: '4px 8px',
                borderRadius: 6,
                transition: 'background 0.12s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 120, 255, 0.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <Plus size={13} /> Import new repository
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
