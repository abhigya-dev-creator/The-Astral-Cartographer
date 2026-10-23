import { useId, useMemo, useRef, useState } from 'react';
import { Box, Code2, FileText, Folder, Search, SquareFunction } from 'lucide-react';
import { useAtlasStore } from './atlasStore';
import { buildSearchIndex, search, type SearchKind, type SearchResult } from './search';

const ICONS: Record<SearchKind, typeof FileText> = { file: FileText, folder: Folder, function: SquareFunction, class: Box, method: Code2 };
const LABEL: Record<SearchKind, string> = { file: 'File', folder: 'Folder', function: 'Function', class: 'Class', method: 'Method' };

export default function SearchBox() {
  const model = useAtlasStore((s) => s.model);
  const query = useAtlasStore((s) => s.search);
  const setSearch = useAtlasStore((s) => s.setSearch);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => (model ? buildSearchIndex(model) : []), [model]);
  const results = useMemo(() => search(index, query), [index, query]);

  const choose = (r: SearchResult) => {
    const s = useAtlasStore.getState();
    if (r.kind === 'folder') s.reveal({ type: 'folder', path: r.path });
    else {
      s.reveal({ type: 'file', path: r.path });
      if (r.line) s.scrollCodeTo(r.path, r.line);
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { if (results[active]) { e.preventDefault(); choose(results[active]); } }
    else if (e.key === 'Escape') {
      e.stopPropagation(); // do not also clear the map selection
      if (open && query) setOpen(false); else { setSearch(''); inputRef.current?.blur(); }
    }
  };

  const showList = open && query.trim().length > 0;
  return (
    <div className="atlas-search">
      <Search size={14} />
      <input
        ref={inputRef}
        className="atlas-input"
        type="search"
        placeholder="Search files, folders, or functions..."
        value={query}
        disabled={!model}
        onChange={(e) => { setSearch(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search files, folders, functions and classes"
      />
      {showList && (
        <ul className="atlas-results" id={listId} role="listbox" aria-label="Search results">
          {results.length === 0 && <li role="option" aria-selected={false} aria-disabled="true">No matches for “{query}”.</li>}
          {results.map((r, i) => {
            const Icon = ICONS[r.kind];
            return (
              <li
                key={`${r.kind}:${r.path}:${r.line ?? ''}:${r.name}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                onMouseEnter={() => setActive(i)}
              >
                <Icon size={14} style={{ flexShrink: 0, color: r.kind === 'folder' ? '#FFD166' : r.kind === 'file' ? '#8EB5FF' : '#A99AFF' }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                    {r.tier === 5 && <span className="atlas-count"> · similar</span>}
                  </span>
                  <span className="atlas-sub" style={{ display: 'block' }}>{r.path}{r.line ? `:${r.line}` : ''}</span>
                </span>
                <span className="atlas-count">{LABEL[r.kind]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
