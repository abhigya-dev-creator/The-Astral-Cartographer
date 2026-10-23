import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { EdgeKind } from '../../../../server/src/services/atlas/types';
import { TYPE_GROUPS, typeGroup, useAtlasStore, type TypeGroup } from './atlasStore';
import { RELATION_COLORS } from './palette';

const KINDS: Array<[EdgeKind, string]> = [['import', 'import'], ['reexport', 'export … from'], ['require', 'require()'], ['dynamic', 'import() (dynamic)']];

function toggled<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v); else next.add(v);
  return next;
}

export default function FiltersMenu({ colorByTop }: { colorByTop: Map<string, string> }) {
  const model = useAtlasStore((s) => s.model);
  const filters = useAtlasStore((s) => s.filters);
  const setFilters = useAtlasStore((s) => s.setFilters);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  if (!model) return null;
  const tops = [...colorByTop.keys()].sort();
  const presentTypes = new Set<TypeGroup>(model.data.files.map((f) => typeGroup(f.ext)));
  const findingFiles = useAtlasStore.getState().findings.size;
  const active = filters.hiddenFolders.size + filters.hiddenTypes.size + filters.hiddenKinds.size + (filters.cyclesOnly ? 1 : 0) + (filters.findingsOnly ? 1 : 0);

  return (
    <div className="atlas-pop" ref={ref}>
      <button ref={btnRef} type="button" className="atlas-chip" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} aria-pressed={active > 0}>
        <SlidersHorizontal size={13} /> Filters{active ? ` (${active})` : ''}
      </button>
      {open && (
        <div className="atlas-pop-panel" role="dialog" aria-label="Map filters">
          <label className="atlas-check" style={{ color: filters.cyclesOnly ? RELATION_COLORS.cycle : undefined }}>
            <input type="checkbox" className="auth-checkbox" checked={filters.cyclesOnly} onChange={(e) => setFilters({ cyclesOnly: e.target.checked })} />
            Circular dependencies only ({model.data.cycles.length})
          </label>
          <label className="atlas-check">
            <input type="checkbox" className="auth-checkbox" checked={filters.findingsOnly} disabled={!findingFiles} onChange={(e) => setFilters({ findingsOnly: e.target.checked })} />
            Files with architectural findings ({findingFiles})
          </label>

          <div className="atlas-section">Folders</div>
          {tops.map((t) => (
            <label key={t} className="atlas-check">
              <input type="checkbox" className="auth-checkbox" checked={!filters.hiddenFolders.has(t)} onChange={() => setFilters({ hiddenFolders: toggled(filters.hiddenFolders, t) })} />
              <span className="atlas-dot" style={{ background: colorByTop.get(t) }} />{t}
            </label>
          ))}

          <div className="atlas-section">File types</div>
          {TYPE_GROUPS.filter((g) => presentTypes.has(g)).map((g) => (
            <label key={g} className="atlas-check">
              <input type="checkbox" className="auth-checkbox" checked={!filters.hiddenTypes.has(g)} onChange={() => setFilters({ hiddenTypes: toggled(filters.hiddenTypes, g) })} />
              {g}
            </label>
          ))}

          <div className="atlas-section">Relationship types</div>
          {KINDS.map(([k, label]) => (
            <label key={k} className="atlas-check">
              <input type="checkbox" className="auth-checkbox" checked={!filters.hiddenKinds.has(k)} onChange={() => setFilters({ hiddenKinds: toggled(filters.hiddenKinds, k) })} />
              <code style={{ fontSize: 11.5 }}>{label}</code>
            </label>
          ))}

          {active > 0 && (
            <button type="button" className="auth-link" style={{ marginTop: 10 }} onClick={() => setFilters({ hiddenFolders: new Set(), hiddenTypes: new Set(), hiddenKinds: new Set(), cyclesOnly: false, findingsOnly: false })}>
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
