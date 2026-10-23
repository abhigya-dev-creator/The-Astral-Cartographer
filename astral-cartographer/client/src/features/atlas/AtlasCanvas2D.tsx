import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Keyboard, LocateFixed, Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { typeGroup, useAtlasStore } from './atlasStore';
import { computeLayout, type AtlasLayout, type LayoutCache } from './layout';
import { AtlasRenderer2D, edgesBetweenTopFolders, type FrameStats, type Hit, type ViewState } from './render2d';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { relatedInOrder } from './graph';
import { isExternalPath } from './externals';
import type { AtlasModel } from './model';

const SHOW_PERF = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');
const SEVERITY_RANK = { info: 0, warning: 1, error: 2 } as const;

interface Props {
  onLayout?: (layout: AtlasLayout) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Plain-language summary of a hit, for the tooltip and the screen-reader announcement. */
function describe(model: AtlasModel, hit: Hit, findingsCount: (p: string) => number): { title: string; lines: string[] } {
  if (hit.type === 'file') {
    const f = model.fileByPath.get(hit.path);
    if (!f) return { title: hit.path, lines: [] };
    const out = new Set((model.outgoing.get(f.path) ?? []).filter((e) => e.status === 'resolved').map((e) => e.to)).size;
    const inc = new Set((model.incoming.get(f.path) ?? []).map((e) => e.from)).size;
    if (isExternalPath(f.path)) return { title: f.name, lines: ['External package (not part of the repository)', `Imported by ${inc} file${inc === 1 ? '' : 's'}`] };
    const lines = [f.folder || '/', `${typeGroup(f.ext)}${f.lines ? ` · ${f.lines.toLocaleString()} lines` : ''}`];
    if (f.kind === 'code') lines.push(`Imports ${out} file${out === 1 ? '' : 's'} · imported by ${inc}`);
    else lines.push(inc ? `Imported by ${inc} file${inc === 1 ? '' : 's'} · no dependency data for this type` : 'No dependency data for this file type');
    if (model.cycleOf.has(f.path)) lines.push('Part of a circular dependency');
    const n = findingsCount(f.path);
    if (n) lines.push(`${n} architectural finding${n === 1 ? '' : 's'}`);
    return { title: f.name, lines };
  }
  if (hit.type === 'folder') {
    const node = model.folderByPath.get(hit.path);
    return { title: `${node?.name ?? hit.path}/`, lines: [`${node?.totalFiles ?? 0} files`, 'Click to expand or collapse'] };
  }
  if (hit.type === 'link') {
    const es = (model.outgoing.get(hit.from) ?? []).filter((e) => e.to === hit.to);
    const a = model.fileByPath.get(hit.from)?.name ?? hit.from;
    const b = model.fileByPath.get(hit.to)?.name ?? hit.to;
    const lines = [`${es[0]?.kind ?? 'import'} on line ${es[0]?.line ?? '?'} of ${a}${es.length > 1 ? ` (+${es.length - 1} more)` : ''}`];
    if (es.some((e) => model.cycleEdges.has(e))) lines.push('Part of a circular dependency');
    lines.push('Click for details');
    return { title: `${a} → ${b}`, lines };
  }
  const n = edgesBetweenTopFolders(model, hit.from, hit.to).length;
  const name = (k: string) => model.folderByPath.get(k)?.name ?? k;
  return { title: `${name(hit.from)} → ${name(hit.to)}`, lines: [`${n} import${n === 1 ? '' : 's'} between these folders`, 'Click for the list'] };
}

export default function AtlasCanvas2D({ onLayout, fullscreen, onToggleFullscreen }: Props) {
  const model = useAtlasStore((s) => s.model);
  const expanded = useAtlasStore((s) => s.expanded);
  const selected = useAtlasStore((s) => s.selected);
  const showDependencies = useAtlasStore((s) => s.showDependencies);
  const showDependents = useAtlasStore((s) => s.showDependents);
  const showAll = useAtlasStore((s) => s.showAll);
  const filters = useAtlasStore((s) => s.filters);
  const isolate = useAtlasStore((s) => s.isolate);
  const trace = useAtlasStore((s) => s.trace);
  const findings = useAtlasStore((s) => s.findings);
  const focus = useAtlasStore((s) => s.focus);
  const anchor = useAtlasStore((s) => s.anchor);
  const reducedMotion = usePrefersReducedMotion();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AtlasRenderer2D | null>(null);
  const hoveredRef = useRef<Hit | null>(null);
  const tooltipShownRef = useRef(false);
  const [tooltip, setTooltip] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [perf, setPerf] = useState<(FrameStats & { layoutMs: number; visible: number }) | null>(null);

  const severity = useMemo(() => {
    const m = new Map<string, 'error' | 'warning' | 'info'>();
    for (const [p, list] of findings) {
      let best: 'error' | 'warning' | 'info' = 'info';
      for (const i of list) if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[best]) best = i.severity;
      if (list.length) m.set(p, best);
    }
    return m;
  }, [findings]);

  // ---- layout (cached per model; only changed clusters are recomputed; toggles keep the previous positions) ----
  const cacheRef = useRef<{ model: unknown; cache: LayoutCache; prev: AtlasLayout | null }>({ model: null, cache: new Map(), prev: null });
  const { layout, layoutMs } = useMemo(() => {
    if (!model) return { layout: null, layoutMs: 0 };
    if (cacheRef.current.model !== model) cacheRef.current = { model, cache: new Map(), prev: null };
    const t = performance.now();
    const l = computeLayout(model.root, expanded, cacheRef.current.cache, cacheRef.current.prev);
    cacheRef.current.prev = l;
    return { layout: l, layoutMs: performance.now() - t };
  }, [model, expanded]);

  const viewState = (hovered: Hit | null): ViewState => {
    const s = useAtlasStore.getState();
    return { selected: s.selected, showDependencies: s.showDependencies, showDependents: s.showDependents, showAll: s.showAll, filters: s.filters, hovered, isolate: s.isolate, trace: s.trace, findings: severity };
  };

  // ---- renderer lifecycle -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new AtlasRenderer2D(canvas);
    rendererRef.current = r;
    let miniPending = false;
    r.onCamera = () => {
      if (miniPending) return;
      miniPending = true;
      requestAnimationFrame(() => { miniPending = false; if (miniRef.current) r.drawMinimap(miniRef.current); });
    };
    let sized = false;
    const ro = new ResizeObserver(() => {
      const box = wrapRef.current!.getBoundingClientRect();
      r.resize(box.width, box.height, window.devicePixelRatio || 1);
      // A focus request handled before the canvas had a real size (fit, or a revealed file/folder) is re-applied now.
      // Later resizes (fullscreen, panel collapse) keep the camera: the same world point stays in the centre.
      if (!sized && box.width > 10) {
        sized = true;
        const f = useAtlasStore.getState().focus;
        if (f?.type === 'file' || f?.type === 'folder') r.focusPath(f.type, f.path);
        else if (f?.type === 'set' && f.paths) r.focusPaths(f.paths);
        else r.fit(false);
      }
      r.onCamera?.();
    });
    ro.observe(wrapRef.current!);
    if (import.meta.env.DEV) (window as unknown as { __atlasDebug?: unknown }).__atlasDebug = { renderer: r, store: useAtlasStore };
    return () => { ro.disconnect(); r.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => { if (rendererRef.current) rendererRef.current.reducedMotion = reducedMotion; }, [reducedMotion]);

  useEffect(() => {
    if (!SHOW_PERF || !rendererRef.current) return;
    // throttled, with a trailing update so the numbers of the last frame are never lost
    let last = 0;
    let trailing = 0;
    const push = (s: FrameStats) => { last = performance.now(); setPerf({ ...s, layoutMs, visible: (layout?.files.length ?? 0) + (layout?.clusters.length ?? 0) }); };
    rendererRef.current.onFrame = (s) => {
      clearTimeout(trailing);
      const snap = { ...s };
      if (performance.now() - last >= 250) push(snap);
      else trailing = window.setTimeout(() => push(snap), 260);
    };
    return () => clearTimeout(trailing);
  }, [layout, layoutMs]);

  // anchor = the folder the user just toggled: the renderer keeps it still on screen
  const anchorRef = useRef<{ key: string; nonce: number } | null>(null);
  const usedAnchor = useRef(0);
  anchorRef.current = anchor;
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !model || !layout) return;
    const a = anchorRef.current && anchorRef.current.nonce !== usedAnchor.current ? anchorRef.current : null;
    if (a) usedAnchor.current = a.nonce;
    r.setScene(model, layout, a?.key ?? null);
    onLayout?.(layout);
    r.onCamera?.();
  }, [model, layout, onLayout]);

  useEffect(() => {
    rendererRef.current?.setState(viewState(hoveredRef.current));
  }, [selected, showDependencies, showDependents, showAll, filters, isolate, trace, severity]);

  // Act once per focus request (after setScene above, so the camera goes to the NEW positions).
  const handledFocus = useRef(0);
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !focus || !layout || focus.nonce === handledFocus.current) return;
    handledFocus.current = focus.nonce;
    if (focus.type === 'fit') r.fit(true);
    else if (focus.type === 'set') r.focusPaths(focus.paths ?? [focus.path]);
    else r.focusPath(focus.type, focus.path);
  }, [focus, layout]);

  // ---- pointer interaction ------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number; type: string } | null = null;
    let dragged = false;
    let pinchDist = 0;
    let showTimer = 0;
    let hideTimer = 0;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const same = (a: Hit | null, b: Hit | null) => JSON.stringify(a) === JSON.stringify(b);
    const setHover = (h: Hit | null, at: { x: number; y: number } | null) => {
      if (!same(hoveredRef.current, h)) {
        hoveredRef.current = h;
        canvas.style.cursor = h ? 'pointer' : 'grab';
        rendererRef.current?.setState(viewState(h));
      }
      // tooltip: appears after a short pause, disappears after a short grace period (no flicker between neighbours)
      clearTimeout(showTimer);
      if (h && at) {
        clearTimeout(hideTimer);
        // once a tooltip is showing, moving to a neighbour updates it at once; the first one waits a moment
        showTimer = window.setTimeout(() => { tooltipShownRef.current = true; setTooltip({ hit: h, x: at.x, y: at.y }); }, tooltipShownRef.current ? 0 : 140);
      } else {
        hideTimer = window.setTimeout(() => { tooltipShownRef.current = false; setTooltip(null); }, 90);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      downAt = { ...local(e), type: e.pointerType };
      dragged = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const r = rendererRef.current;
      if (!r) return;
      if (!pointers.has(e.pointerId)) { setHover(r.hitTest(p.x, p.y, hoveredRef.current), p); return; }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) r.zoomAt(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist = d;
        dragged = true;
        return;
      }
      // a small wobble while clicking is still a click; beyond the threshold the gesture is a pan
      const threshold = downAt?.type === 'mouse' ? 4 : 8;
      if (!dragged && downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > threshold) {
        dragged = true;
        setHover(null, null);
        r.panBy(p.x - downAt.x, p.y - downAt.y);
      } else if (dragged) {
        canvas.style.cursor = 'grabbing';
        r.panBy(p.x - prev.x, p.y - prev.y);
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasPinch = pointers.size > 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (dragged || wasPinch || !downAt) { downAt = null; canvas.style.cursor = hoveredRef.current ? 'pointer' : 'grab'; return; }
      downAt = null;
      const p = local(e);
      const hit = rendererRef.current?.hitTest(p.x, p.y, hoveredRef.current) ?? null;
      const store = useAtlasStore.getState();
      if (!hit) store.select(null);
      else if (hit.type === 'file') store.select({ type: 'file', path: hit.path });
      else if (hit.type === 'folder') { store.toggleFolder(hit.path); store.select({ type: 'folder', path: hit.path }); }
      else store.select(hit);
    };
    const onDouble = (e: MouseEvent) => {
      const p = local(e);
      const hit = rendererRef.current?.hitTest(p.x, p.y);
      if (hit?.type === 'file') useAtlasStore.getState().focusSelection();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const r = rendererRef.current;
      if (!r) return;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // trackpad pinch arrives as ctrl+wheel with small deltas: apply directly; mouse wheel: eased and capped per event
      if (e.ctrlKey) r.zoomAt(Math.exp(-delta * 0.01), p.x, p.y);
      else r.wheelZoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.0022), p.x, p.y);
    };
    const onLeave = () => { if (!pointers.size) setHover(null, null); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(showTimer); clearTimeout(hideTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [severity]);

  // ---- keyboard ---------------------------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rendererRef.current;
    const s = useAtlasStore.getState();
    if (!r || !s.model) return;
    const step = 60;
    const stepRelated = (dir: 1 | -1) => {
      const cur = s.selected?.type === 'file' ? s.selected.path : null;
      const anchorPath = s.isolate?.path ?? cur;
      if (!anchorPath) return;
      const list = relatedInOrder(s.model!, anchorPath);
      if (!list.length) return;
      const i = cur && cur !== anchorPath ? list.indexOf(cur) : -1;
      const next = list[(i + dir + list.length) % list.length];
      s.reveal({ type: 'file', path: next });
    };
    const keys: Record<string, () => void> = {
      '+': () => r.zoomCenter(1.3), '=': () => r.zoomCenter(1.3), '-': () => r.zoomCenter(1 / 1.3), '0': () => r.fit(),
      ArrowLeft: () => r.panBy(step, 0), ArrowRight: () => r.panBy(-step, 0), ArrowUp: () => r.panBy(0, step), ArrowDown: () => r.panBy(0, -step),
      f: () => s.focusSelection(), F: () => s.focusSelection(),
      i: () => { if (s.isolate) s.setIsolate(null); else if (s.selected?.type === 'file') s.setIsolate(s.selected.path, 1); },
      ']': () => stepRelated(1), '[': () => stepRelated(-1),
      '?': () => setShowHelp((v) => !v),
    };
    const fn = keys[e.key];
    if (fn && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); fn(); }
  };

  // ---- minimap drag ---------------------------------------------------------------------------
  const onMini = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    else if (!(e.buttons & 1)) return;
    const b = e.currentTarget.getBoundingClientRect();
    rendererRef.current?.minimapTo(e.currentTarget, e.clientX - b.left, e.clientY - b.top);
  };

  const legend = layout ? [...layout.colorByTop.entries()].sort(([a], [b]) => (a < b ? -1 : 1)) : [];
  const findingsCount = (p: string) => findings.get(p)?.length ?? 0;
  const tip = tooltip && model ? describe(model, tooltip.hit, findingsCount) : null;
  const stageW = wrapRef.current?.clientWidth ?? 0;
  const stageH = wrapRef.current?.clientHeight ?? 0;
  const announcement = useMemo(() => {
    if (!model || !selected) return 'No selection.';
    if (selected.type === 'file' || selected.type === 'folder' || selected.type === 'link' || selected.type === 'folderLink') {
      const d = describe(model, selected, findingsCount);
      return `Selected ${d.title}. ${d.lines.filter((l) => !/^Click/.test(l)).join('. ')}.`;
    }
    return '';
  }, [model, selected, findings]);
  const canFocus = !!(selected && selected.type !== 'folderLink') || !!isolate;

  return (
    <div className="atlas-stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="atlas-canvas"
        tabIndex={0}
        role="application"
        aria-roledescription="dependency map"
        aria-label="Dependency map. Drag to pan, scroll to zoom, click a file to select it. Keys: plus and minus zoom, 0 fits the map, F focuses the selection, I isolates it, square brackets step through related files, Escape steps back, question mark shows all shortcuts."
        onKeyDown={onKeyDown}
        style={{ cursor: 'grab' }}
      />
      <div className="atlas-visually-hidden" aria-live="polite">{announcement}</div>

      <div className="atlas-controls" role="toolbar" aria-label="Map controls">
        <button type="button" className="atlas-icon-btn" onClick={() => rendererRef.current?.zoomCenter(1.3)} aria-label="Zoom in" title="Zoom in (+)"><Plus size={16} /></button>
        <button type="button" className="atlas-icon-btn" onClick={() => rendererRef.current?.zoomCenter(1 / 1.3)} aria-label="Zoom out" title="Zoom out (−)"><Minus size={16} /></button>
        <button type="button" className="atlas-icon-btn" onClick={() => rendererRef.current?.fit()} aria-label="Fit the whole map" title="Fit the whole map (0)"><LocateFixed size={16} /></button>
        <button type="button" className="atlas-icon-btn" onClick={() => useAtlasStore.getState().focusSelection()} disabled={!canFocus} aria-label="Focus the selection" title="Focus the selection (F)"><Crosshair size={16} /></button>
        <button type="button" className="atlas-icon-btn" onClick={() => { useAtlasStore.getState().clear(); rendererRef.current?.fit(); }} aria-label="Reset view and selection" title="Reset: clear selection, isolation and trace, then fit"><RotateCcw size={15} /></button>
        <button type="button" className="atlas-icon-btn" onClick={onToggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-pressed={fullscreen} title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button type="button" className="atlas-icon-btn" onClick={() => setShowHelp((v) => !v)} aria-label="Keyboard shortcuts" aria-expanded={showHelp} title="Keyboard shortcuts (?)"><Keyboard size={15} /></button>
      </div>

      {showHelp && (
        <div className="atlas-help" role="dialog" aria-label="Keyboard shortcuts">
          <dl>
            <dt>Drag / arrows</dt><dd>Pan</dd>
            <dt>Wheel / + −</dt><dd>Zoom</dd>
            <dt>0</dt><dd>Fit the whole map</dd>
            <dt>F / double-click</dt><dd>Focus the selection</dd>
            <dt>I</dt><dd>Isolate the selected file</dd>
            <dt>[ ]</dt><dd>Previous / next related file</dd>
            <dt>Esc</dt><dd>Step back (isolation, trace, selection, fullscreen)</dd>
            <dt>/</dt><dd>Search</dd>
          </dl>
          <button type="button" className="auth-link" onClick={() => setShowHelp(false)}>Close</button>
        </div>
      )}

      {isolate && (
        <div className="atlas-banner" role="status">
          Isolated: <strong>{model?.fileByPath.get(isolate.path)?.name}</strong> and {isolate.members.size - 1} related file{isolate.members.size === 2 ? '' : 's'} ({isolate.depth} step{isolate.depth > 1 ? 's' : ''})
          <button type="button" className="auth-link" onClick={() => useAtlasStore.getState().setIsolate(null)}>Exit isolation</button>
        </div>
      )}
      {!isolate && trace && (
        <div className="atlas-banner" role="status">
          {trace.path
            ? <>Trace: {trace.path.length - 1} step{trace.path.length === 2 ? '' : 's'}{trace.reversed ? ' (the dependency runs the other way)' : ''}</>
            : <>No import chain between these files in either direction.</>}
          <button type="button" className="auth-link" onClick={() => useAtlasStore.getState().setTrace(null)}>Clear trace</button>
        </div>
      )}

      {legend.length > 0 && !fullscreen && (
        <ul className="atlas-legend" aria-label="Folder colours">
          {legend.map(([name, color]) => (
            <li key={name}><span className="atlas-dot" style={{ background: color }} />{name}</li>
          ))}
        </ul>
      )}

      <canvas ref={miniRef} className="atlas-minimap" aria-label="Minimap: click or drag to move the view" onPointerDown={onMini} onPointerMove={onMini} />

      {tip && tooltip && (
        <div
          className="atlas-tooltip"
          role="tooltip"
          style={{ left: Math.min(tooltip.x + 14, Math.max(0, stageW - 300)), top: tooltip.y + 16 > stageH - 110 ? tooltip.y - 96 : tooltip.y + 16 }}
        >
          <div className="atlas-tooltip-title">{tip.title}</div>
          {tip.lines.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}

      {SHOW_PERF && perf && (
        <div className="atlas-perf" aria-hidden="true">
          <div>draw {perf.drawMs.toFixed(2)} ms/frame</div>
          <div>{perf.fps ? `${perf.fps.toFixed(0)} fps (while moving)` : 'idle (no redraw)'}</div>
          <div>{perf.nodes} nodes · {perf.edges} edges · {perf.labels} labels drawn</div>
          <div>{perf.visible} laid out · layout {layoutMs.toFixed(1)} ms</div>
        </div>
      )}
    </div>
  );
}
