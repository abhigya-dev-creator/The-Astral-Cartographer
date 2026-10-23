import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileText, Folder, Search, Braces } from 'lucide-react';
import { buildSearchIndex, search, type SearchResult } from '../atlas/search';
import type { RepoFacts } from './repoFacts';

export interface SearchPick { path: string; line?: number; kind: SearchResult['kind']; name: string }

interface Props {
  facts: RepoFacts | null;
  onPick: (pick: SearchPick) => void;
  /** short text per result saying what choosing it does */
  describe: (r: SearchResult) => string;
}

/** Search the selected repository's files, folders, functions and classes (from the analysis). */
export default function PathSearch({ facts, onPick, describe }: Props) {
  const index = useMemo(() => (facts ? buildSearchIndex(facts.model) : []), [facts]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const results = useMemo(() => (q.trim() ? search(index, q.trim(), 12) : []), [index, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (r: SearchResult) => {
    onPick({ path: r.path, line: r.line, kind: r.kind, name: r.name });
    setOpen(false);
    setQ('');
  };

  return (
    <div className="pf-search" ref={box}>
      <Search size={15} color="#77839C" aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search files, folders or concepts in this repository"
        placeholder={facts ? 'Search files, folders or concepts…' : 'Search becomes available when the analysis is loaded'}
        disabled={!facts}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else setOpen(false); }
        }}
      />
      {open && q.trim() && (
        <ul className="pf-search-results" id={listId} role="listbox" aria-label="Search results">
          {results.length === 0 && <li className="pf-search-empty" role="option" aria-selected={false} aria-disabled="true">No file, folder, function or class matches “{q.trim()}”.</li>}
          {results.map((r, i) => (
            <li
              key={`${r.kind}:${r.path}:${r.name}:${r.line ?? ''}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
            >
              <span className="pf-search-icon" aria-hidden="true">{r.kind === 'folder' ? <Folder size={14} /> : r.kind === 'file' ? <FileText size={14} /> : <Braces size={14} />}</span>
              <span className="pf-search-main">
                <span className="pf-search-name">{r.name}{r.kind !== 'file' && r.kind !== 'folder' && <span className="pf-muted"> · {r.kind}{r.line ? `, line ${r.line}` : ''}</span>}</span>
                <span className="pf-search-path">{r.path}</span>
                <span className="pf-search-hint">{describe(r)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
