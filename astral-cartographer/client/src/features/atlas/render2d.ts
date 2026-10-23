import type { AtlasModel, Edge, FileNode } from './model';
import type { AtlasLayout, LCluster, LFile } from './layout';
import { visualAnchor } from './layout';
import { GridIndex } from './spatialIndex';
import { RELATION_COLORS, withAlpha } from './palette';
import type { AtlasFilters, IsolateState, Selection } from './atlasStore';
import { edgePassesFilters, filePassesFilters } from './filters';
import { isExternalPath } from './externals';
import type { TraceResult } from './graph';

/** What the pointer is over. Links are between files; folder links between top-level folders (zoomed-out Show all). */
export type Hit =
  | { type: 'file'; path: string }
  | { type: 'folder'; path: string }
  | { type: 'link'; from: string; to: string }
  | { type: 'folderLink'; from: string; to: string };

export interface ViewState {
  selected: Selection;
  showDependencies: boolean;
  showDependents: boolean;
  showAll: boolean;
  filters: AtlasFilters;
  hovered: Hit | null;
  isolate: IsolateState | null;
  trace: TraceResult | null;
  /** highest severity per file with architectural findings */
  findings: ReadonlyMap<string, 'error' | 'warning' | 'info'>;
}

export interface FrameStats {
  /** time spent inside draw(), ms (average of the last 30 frames) */
  drawMs: number;
  /** frames per second while continuously redrawing (pan/zoom/animation); 0 when idle */
  fps: number;
  nodes: number;
  edges: number;
  labels: number;
}

interface Pos { x: number; y: number; r: number }
interface Camera { x: number; y: number; k: number }
interface DrawnLink { hit: Hit; pts: number[]; minX: number; minY: number; maxX: number; maxY: number }

/** below this zoom, Show All draws folder-to-folder lines instead of file lines */
export const AGGREGATE_ZOOM = 0.38;
const FILE_LABEL_ZOOM = 0.8;
const ANIM_MS = 320;
/** on-screen size limits (CSS px): nodes stay clickable when zoomed out and never balloon when zoomed in */
export const NODE_PX = { FILE_MIN: 3.5, FILE_MAX: 12, HUB_MIN: 7, HUB_MAX: 32 };
const TRACE_COLOR = '#37D9FF';
const LINK_COLOR = '#EAF0FF';
const SEVERITY_COLOR = { error: '#FF717A', warning: '#FFD166', info: '#6898FF' } as const;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pre-rendered radial glow per colour (drawn scaled with drawImage: far cheaper than shadowBlur). */
const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, withAlpha(color, 0.55));
  grad.addColorStop(0.35, withAlpha(color, 0.22));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

export class AtlasRenderer2D {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  cam: Camera = { x: 0, y: 0, k: 1 };
  private camAnim: { from: Camera; to: Camera; start: number; dur: number } | null = null;
  /** smooth wheel zoom: the camera eases towards this zoom, keeping the world point under the cursor fixed */
  private zoomGoal: { k: number; sx: number; sy: number } | null = null;
  private minK = 0.03;
  private maxK = 4;

  private model: AtlasModel | null = null;
  private layout: AtlasLayout | null = null;
  private state: ViewState | null = null;

  private fileIndex = new GridIndex<LFile>(48);
  private clusterIndex = new GridIndex<LCluster>(160);
  /** displayed positions (animated) */
  private fromFile = new Map<string, Pos>();
  private fromCluster = new Map<string, Pos & { blob: number[] | null }>();
  private ghosts: Array<{ from: Pos; to: Pos; color: string }> = [];
  private animStart = 0;
  private animating = false;

  private bundled: { paths: Float32Array[]; bbox: Float32Array; edges: Edge[] } | null = null;
  private aggregated: Array<{ a: LCluster; b: LCluster; count: number; cycle: boolean }> | null = null;
  private aggregatedFor: AtlasFilters | null = null;
  /** clickable links drawn in the last frame (world coordinates) */
  private drawnLinks: DrawnLink[] = [];

  private raf = 0;
  private drawTimes: number[] = [];
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  stats: FrameStats = { drawMs: 0, fps: 0, nodes: 0, edges: 0, labels: 0 };
  onFrame: ((s: FrameStats) => void) | null = null;
  onCamera: (() => void) | null = null;
  reducedMotion = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.w = Math.max(1, cssW);
    this.h = Math.max(1, cssH);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.updateZoomLimits();
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------------------
  // Scene
  // ------------------------------------------------------------------------------------------------
  /**
   * New layout. `anchorKey` = the folder the user just expanded/collapsed: the camera follows it so it stays
   * exactly where it was on screen, and the transition starts from positions shifted the same way.
   */
  setScene(model: AtlasModel, layout: AtlasLayout, anchorKey: string | null = null) {
    const prevLayout = this.layout;
    const sameModel = this.model === model;
    this.model = model;
    this.layout = layout;
    this.bundled = null;
    this.aggregated = null;

    this.fileIndex.clear();
    this.clusterIndex.clear();
    for (const f of layout.files) this.fileIndex.insert(f, f.x, f.y, f.r);
    for (const c of layout.clusters) this.clusterIndex.insert(c, c.expanded ? c.cx : c.x, c.expanded ? c.cy : c.y, c.expanded ? c.r : c.hubR);
    this.updateZoomLimits();

    let shiftX = 0, shiftY = 0;
    if (prevLayout && anchorKey) {
      const a = prevLayout.clusterByPath.get(anchorKey);
      const b = layout.clusterByPath.get(anchorKey);
      if (a && b) {
        shiftX = b.x - a.x;
        shiftY = b.y - a.y;
        this.camAnim = null;
        this.zoomGoal = null;
        this.cam = { ...this.cam, x: this.cam.x + shiftX, y: this.cam.y + shiftY };
        this.onCamera?.();
      }
    }

    this.fromFile.clear();
    this.fromCluster.clear();
    this.ghosts = [];
    if (prevLayout && sameModel && !this.reducedMotion) {
      const prevCluster = (c: LCluster | null): Pos | null => {
        for (let p = c; p; p = p.parent) {
          const old = prevLayout.clusterByPath.get(p.key);
          if (old) return { x: old.x + shiftX, y: old.y + shiftY, r: 0 };
        }
        return null;
      };
      for (const c of layout.clusters) {
        const old = prevLayout.clusterByPath.get(c.key);
        if (old) this.fromCluster.set(c.key, { x: old.x + shiftX, y: old.y + shiftY, r: old.hubR, blob: old.blob ? old.blob.map((v, i) => v + (i % 2 ? shiftY : shiftX)) : null });
        else { const p = prevCluster(c.parent); if (p) this.fromCluster.set(c.key, { ...p, blob: null }); }
      }
      for (const f of layout.files) {
        const old = prevLayout.fileByPath.get(f.file.path);
        if (old) this.fromFile.set(f.file.path, { x: old.x + shiftX, y: old.y + shiftY, r: old.r });
        else { const p = prevCluster(f.cluster); if (p) this.fromFile.set(f.file.path, p); }
      }
      for (const old of prevLayout.files) {
        if (layout.fileByPath.has(old.file.path)) continue;
        const a = visualAnchor(layout, old.file, (p) => model.folderByPath.get(p));
        if (a) this.ghosts.push({ from: { x: old.x + shiftX, y: old.y + shiftY, r: old.r }, to: { x: a.x, y: a.y, r: 0 }, color: old.color });
      }
      this.animStart = performance.now();
      this.animating = true;
    }
    this.invalidate();
  }

  setState(state: ViewState) {
    this.state = state;
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------------------------------------
  /** Zoom limits relative to the content: from half of "whole map fits" to a readable close-up. */
  private updateZoomLimits() {
    if (!this.layout) return;
    const b = this.layout.bounds;
    const fitK = Math.min((this.w - 80) / Math.max(1, b.maxX - b.minX), (this.h - 80) / Math.max(1, b.maxY - b.minY));
    this.maxK = clamp(Math.max(fitK * 3, 3), 3, 8);
    this.minK = Math.min(Math.max(fitK * 0.5, 0.005), this.maxK);
  }

  get zoomLimits() {
    return { min: this.minK, max: this.maxK };
  }

  worldToScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.k + this.w / 2, y: (y - this.cam.y) * this.cam.k + this.h / 2 };
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.cam.k + this.cam.x, y: (sy - this.h / 2) / this.cam.k + this.cam.y };
  }

  private setCam(to: Camera, animate: boolean) {
    to = { ...to, k: clamp(to.k, this.minK, this.maxK) };
    this.zoomGoal = null;
    if (!animate || this.reducedMotion) {
      this.cam = to;
      this.camAnim = null;
    } else {
      this.camAnim = { from: { ...this.cam }, to, start: performance.now(), dur: 420 };
    }
    this.onCamera?.();
    this.invalidate();
  }

  panBy(dx: number, dy: number) {
    this.camAnim = null;
    this.cam = { ...this.cam, x: this.cam.x - dx / this.cam.k, y: this.cam.y - dy / this.cam.k };
    this.onCamera?.();
    this.invalidate();
  }

  /** Immediate zoom by `factor` keeping the world point under (sx, sy) fixed (pinch gestures). */
  zoomAt(factor: number, sx: number, sy: number) {
    this.camAnim = null;
    this.zoomGoal = null;
    this.applyZoom(clamp(this.cam.k * factor, this.minK, this.maxK), sx, sy);
  }

  private applyZoom(k: number, sx: number, sy: number) {
    const before = this.screenToWorld(sx, sy);
    this.cam = { x: before.x - (sx - this.w / 2) / k, y: before.y - (sy - this.h / 2) / k, k };
    this.onCamera?.();
    this.invalidate();
  }

  /** Mouse wheel: accumulate into a target zoom and ease towards it (no jumps, bounded). */
  wheelZoom(factor: number, sx: number, sy: number) {
    this.camAnim = null;
    const base = this.zoomGoal ? this.zoomGoal.k : this.cam.k;
    this.zoomGoal = { k: clamp(base * factor, this.minK, this.maxK), sx, sy };
    this.invalidate();
  }

  zoomCenter(factor: number) {
    const k = clamp(this.cam.k * factor, this.minK, this.maxK);
    const c = this.screenToWorld(this.w / 2, this.h / 2);
    this.setCam({ x: c.x, y: c.y, k }, true);
  }

  fitToBounds(b: { minX: number; minY: number; maxX: number; maxY: number }, animate = true, padding = 40, maxZoom = Infinity) {
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const k = Math.min((this.w - padding * 2) / bw, (this.h - padding * 2) / bh, maxZoom);
    this.setCam({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, k }, animate);
  }

  fit(animate = true) {
    if (this.layout) this.fitToBounds(this.layout.bounds, animate);
  }

  /** Centre on a point; zoom in only as far as needed for the node to be comfortably readable (never zooms out). */
  focusOn(x: number, y: number) {
    const readable = 1.1;
    this.setCam({ x, y, k: Math.max(this.cam.k, Math.min(readable, this.maxK)) }, true);
  }

  focusPath(type: 'file' | 'folder', path: string) {
    if (!this.layout || !this.model) return;
    if (type === 'file') {
      const f = this.model.fileByPath.get(path);
      const a = f ? visualAnchor(this.layout, f, (p) => this.model!.folderByPath.get(p)) : null;
      if (a) this.focusOn(a.x, a.y);
    } else {
      const node = this.model.folderByPath.get(path);
      const c = node ? this.layout.clusterByPath.get(node.path) : null;
      if (c) {
        const cx = c.expanded ? c.cx : c.x, cy = c.expanded ? c.cy : c.y, r = c.expanded ? c.r : c.hubR * 4;
        this.fitToBounds({ minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r }, true, 80, 1.6);
      }
    }
  }

  /** Frame a set of files (isolation, trace, link). */
  focusPaths(paths: string[]) {
    if (!this.layout || !this.model) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of paths) {
      const f = this.model.fileByPath.get(p);
      const a = f ? visualAnchor(this.layout, f, (x) => this.model!.folderByPath.get(x)) : null;
      if (!a) continue;
      minX = Math.min(minX, a.x - 40); maxX = Math.max(maxX, a.x + 40); minY = Math.min(minY, a.y - 40); maxY = Math.max(maxY, a.y + 40);
    }
    if (minX < Infinity) this.fitToBounds({ minX, minY, maxX, maxY }, true, 70, 1.6);
  }

  get viewport() {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(this.w, this.h);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  /** Radius a file is drawn with (world units): clamped to NODE_PX on screen. */
  private fileR(r: number) {
    return clamp(r * this.cam.k, NODE_PX.FILE_MIN, NODE_PX.FILE_MAX) / this.cam.k;
  }

  private hubR(r: number) {
    return clamp(r * this.cam.k, NODE_PX.HUB_MIN, NODE_PX.HUB_MAX) / this.cam.k;
  }

  // ------------------------------------------------------------------------------------------------
  // Hit testing (screen coordinates)
  // ------------------------------------------------------------------------------------------------
  /**
   * Nearest file, folder hub or drawn link under the pointer. Files win over hubs, hubs over links.
   * `sticky` (the item currently hovered) keeps winning within a few extra pixels, so moving between
   * neighbouring items does not make the tooltip flicker.
   */
  hitTest(sx: number, sy: number, sticky: Hit | null = null): Hit | null {
    if (!this.layout || !this.model) return null;
    const k = this.cam.k;
    const p = this.screenToWorld(sx, sy);
    const slackPx = 4;
    const stickyPx = 8;
    const reach = (NODE_PX.HUB_MAX + stickyPx) / k;

    if (sticky?.type === 'file') {
      const f = this.layout.fileByPath.get(sticky.path);
      if (f && Math.hypot(f.x - p.x, f.y - p.y) * k <= this.fileR(f.r) * k + stickyPx) return sticky;
    }
    let bestFile: LFile | null = null, bestD = Infinity;
    for (const f of this.fileIndex.queryRect(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const d = Math.hypot(f.x - p.x, f.y - p.y) * k - this.fileR(f.r) * k; // distance to the drawn rim, px
      if (d <= slackPx && d < bestD) { bestD = d; bestFile = f; }
    }
    if (bestFile) return { type: 'file', path: bestFile.file.path };

    let bestHub: LCluster | null = null; bestD = Infinity;
    for (const c of this.clusterIndex.queryRect(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      if (c.isRootFiles) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y) * k - this.hubR(c.hubR) * k;
      if (d <= slackPx && d < bestD) { bestD = d; bestHub = c; }
    }
    if (bestHub) return { type: 'folder', path: bestHub.key };

    // links drawn in the last frame
    let bestLink: DrawnLink | null = null; bestD = Infinity;
    const tol = 6 / k;
    for (const l of this.drawnLinks) {
      if (p.x < l.minX - tol * 3 || p.x > l.maxX + tol * 3 || p.y < l.minY - tol * 3 || p.y > l.maxY + tol * 3) continue;
      const d = distToPolyline(p.x, p.y, l.pts);
      const isSticky = !!sticky && sticky.type === l.hit.type && 'from' in sticky && 'from' in l.hit && sticky.from === l.hit.from && sticky.to === l.hit.to;
      const limit = isSticky ? (6 + stickyPx) / k : tol;
      if (d <= limit && d < bestD) { bestD = d; bestLink = l; }
    }
    return bestLink ? bestLink.hit : null;
  }

  /** Screen position of a file's drawn node (tests and keyboard support); null when not laid out. */
  screenOf(path: string): { x: number; y: number } | null {
    if (!this.layout || !this.model) return null;
    const f = this.model.fileByPath.get(path);
    const a = f ? visualAnchor(this.layout, f, (x) => this.model!.folderByPath.get(x)) : null;
    return a ? this.worldToScreen(a.x, a.y) : null;
  }

  screenOfFolder(path: string): { x: number; y: number } | null {
    const c = this.layout?.clusterByPath.get(path);
    return c ? this.worldToScreen(c.x, c.y) : null;
  }

  /** A clickable point in the middle of a drawn link (tests). */
  screenOfLink(from: string, to: string): { x: number; y: number } | null {
    const l = this.drawnLinks.find((d) => 'from' in d.hit && d.hit.from === from && d.hit.to === to);
    if (!l) return null;
    const i = Math.floor(l.pts.length / 4) * 2;
    return this.worldToScreen(l.pts[i], l.pts[i + 1]);
  }

  // ------------------------------------------------------------------------------------------------
  // Frame loop
  // ------------------------------------------------------------------------------------------------
  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    const t0 = performance.now();
    if (this.camAnim) {
      const t = Math.min(1, (now - this.camAnim.start) / this.camAnim.dur);
      const e = ease(t);
      const { from, to } = this.camAnim;
      this.cam = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), k: from.k * Math.pow(to.k / from.k, e) };
      if (t >= 1) this.camAnim = null;
      this.onCamera?.();
    }
    if (this.zoomGoal) {
      const g = this.zoomGoal;
      const ratio = g.k / this.cam.k;
      if (this.reducedMotion || Math.abs(Math.log(ratio)) < 0.003) { this.applyZoom(g.k, g.sx, g.sy); this.zoomGoal = null; }
      else this.applyZoom(this.cam.k * Math.pow(ratio, 0.35), g.sx, g.sy);
    }
    const animT = this.animating ? Math.min(1, (now - this.animStart) / ANIM_MS) : 1;
    if (animT >= 1 && this.animating) { this.animating = false; this.ghosts = []; this.fromFile.clear(); this.fromCluster.clear(); }
    this.draw(ease(animT));
    const dt = performance.now() - t0;
    this.drawTimes.push(dt);
    if (this.drawTimes.length > 30) this.drawTimes.shift();

    const continuous = this.animating || !!this.camAnim || !!this.zoomGoal;
    if (this.lastFrameAt && now - this.lastFrameAt < 100) {
      this.frameTimes.push(now - this.lastFrameAt);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
    } else this.frameTimes = [];
    this.lastFrameAt = now;
    this.stats.drawMs = this.drawTimes.reduce((s, x) => s + x, 0) / this.drawTimes.length;
    this.stats.fps = this.frameTimes.length >= 5 ? 1000 / (this.frameTimes.reduce((s, x) => s + x, 0) / this.frameTimes.length) : 0;
    this.onFrame?.(this.stats);
    if (continuous) this.invalidate();
  }

  // ------------------------------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------------------------------
  private filePos(f: LFile, t: number): Pos {
    const from = t < 1 ? this.fromFile.get(f.file.path) : undefined;
    const r = this.fileR(f.r);
    return from ? { x: lerp(from.x, f.x, t), y: lerp(from.y, f.y, t), r: lerp(from.r ? this.fileR(from.r) : 0, r, t) } : { x: f.x, y: f.y, r };
  }

  private clusterPos(c: LCluster, t: number): Pos {
    const from = t < 1 ? this.fromCluster.get(c.key) : undefined;
    const r = this.hubR(c.hubR);
    return from ? { x: lerp(from.x, c.x, t), y: lerp(from.y, c.y, t), r: lerp(from.r ? this.hubR(from.r) : 0, r, t) } : { x: c.x, y: c.y, r };
  }

  private draw(t: number) {
    const ctx = this.ctx;
    const { model, layout, state } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawnLinks = [];
    if (!model || !layout || !state) return;

    const k = this.cam.k;
    const dpr = this.dpr;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (this.w / 2 - this.cam.x * k), dpr * (this.h / 2 - this.cam.y * k));
    const vp = this.viewport;
    const margin = 60 / k;
    const visFiles = this.fileIndex.queryRect(vp.minX - margin, vp.minY - margin, vp.maxX + margin, vp.maxY + margin);
    const visClusters = this.clusterIndex.queryRect(vp.minX - margin, vp.minY - margin, vp.maxX + margin, vp.maxY + margin);
    const folderOf = (p: string) => model.folderByPath.get(p);

    // ---- what is emphasised -----------------------------------------------------------------------
    const sel = state.selected;
    const selFile = sel?.type === 'file' ? model.fileByPath.get(sel.path) ?? null : null;
    const selLink = sel?.type === 'link' ? sel : null;
    const selFolderLink = sel?.type === 'folderLink' ? sel : null;
    const related = new Set<string>();
    const relEdges: Array<{ e: Edge; dir: 'dep' | 'dependent' }> = [];
    const kindOk = (e: Edge) => !state.filters.hiddenKinds.has(e.kind);
    if (selFile) {
      related.add(selFile.path);
      if (state.showDependencies) for (const e of model.outgoing.get(selFile.path) ?? []) {
        if (e.to && e.status === 'resolved' && kindOk(e)) { related.add(e.to); relEdges.push({ e, dir: 'dep' }); }
      }
      if (state.showDependents) for (const e of model.incoming.get(selFile.path) ?? []) {
        if (kindOk(e)) { related.add(e.from); relEdges.push({ e, dir: 'dependent' }); }
      }
    }
    if (selLink) { related.add(selLink.from); related.add(selLink.to); }
    const tracePath = state.trace?.path ?? null;
    const traceSet = new Set(tracePath ?? []);
    const iso = state.isolate?.members ?? null;
    const selFolder = sel?.type === 'folder' ? model.folderByPath.get(sel.path) ?? null : null;
    const inSelFolder = (folderPath: string) => {
      if (!selFolder) return true;
      for (let f = model.folderByPath.get(folderPath) ?? null; f; f = f.parent) if (f === selFolder) return true;
      return false;
    };
    const filters = state.filters;
    const filtering = filters.cyclesOnly || filters.findingsOnly || filters.hiddenFolders.size > 0 || filters.hiddenTypes.size > 0;
    const findingsAsLists = new Map([...state.findings.keys()].map((p) => [p, [1]]));
    const fileAlpha = (file: FileNode) => {
      let a = 1;
      if (iso) a = iso.has(file.path) ? 1 : 0.07;
      if (tracePath) a = traceSet.has(file.path) ? 1 : Math.min(a, 0.12);
      else if ((selFile || selLink) && !related.has(file.path)) a = Math.min(a, iso?.has(file.path) ? 0.55 : 0.16);
      if (selFolder && !inSelFolder(file.folder)) a = Math.min(a, 0.3);
      if (filtering && !filePassesFilters(file, filters, model, findingsAsLists)) a = Math.min(a, 0.12);
      return a;
    };
    const emphasised = new Set<LCluster>();
    const emphasise = (paths: Iterable<string>) => {
      for (const p of paths) {
        const f = model.fileByPath.get(p);
        const a = f ? visualAnchor(layout, f, folderOf) : null;
        for (let c = a?.cluster ?? null; c; c = c.parent) emphasised.add(c);
      }
    };
    if (iso) emphasise(iso);
    if (tracePath) emphasise(tracePath);
    if (selFile || selLink) emphasise(related);
    const anyFocus = !!(iso || tracePath || selFile || selLink);
    const clusterAlpha = (c: LCluster) => {
      if (anyFocus) return emphasised.has(c) ? 0.9 : iso || tracePath ? 0.12 : 0.25;
      if (selFolder && !inSelFolder(c.folder.path) && c.folder !== selFolder) return 0.35;
      if (selFolderLink) return c.key === selFolderLink.from || c.key === selFolderLink.to ? 1 : 0.3;
      if (filters.hiddenFolders.size && filters.hiddenFolders.has(c.folder.top || c.folder.name)) return 0.15;
      return 1;
    };

    // ---- blobs ---------------------------------------------------------------------------------
    const clusters = [...visClusters].sort((a, b) => a.depth - b.depth);
    for (const c of clusters) {
      if (!c.blob) continue;
      const from = t < 1 ? this.fromCluster.get(c.key) : undefined;
      const a = clusterAlpha(c);
      ctx.beginPath();
      const pts = c.blob;
      const n = pts.length / 2;
      const px = (i: number) => {
        const j = (i % n) * 2;
        if (!from) return [pts[j], pts[j + 1]];
        if (from.blob && from.blob.length === pts.length) return [lerp(from.blob[j], pts[j], t), lerp(from.blob[j + 1], pts[j + 1], t)];
        const cx = lerp(from.x, c.x, t), cy = lerp(from.y, c.y, t);
        return [cx + (pts[j] - c.x) * t, cy + (pts[j + 1] - c.y) * t];
      };
      let [x0, y0] = px(0);
      let [x1, y1] = px(1);
      ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
      for (let i = 1; i <= n; i++) {
        [x0, y0] = px(i);
        [x1, y1] = px(i + 1);
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      ctx.closePath();
      ctx.fillStyle = withAlpha(c.color, (c.depth <= 1 ? 0.075 : 0.05) * a);
      ctx.fill();
      ctx.lineWidth = 6 / k;
      ctx.strokeStyle = withAlpha(c.color, 0.06 * a);
      ctx.stroke();
      ctx.lineWidth = 1.2 / k;
      ctx.strokeStyle = withAlpha(c.color, 0.42 * a);
      ctx.stroke();
    }

    // ---- structure spokes (hub -> child), batched per colour --------------------------------------
    const spokes = new Map<string, Array<[number, number, number, number]>>();
    for (const f of visFiles) {
      const fp = this.filePos(f, t);
      const hp = this.clusterPos(f.cluster, t);
      const key = withAlpha(f.color, 0.28 * Math.min(fileAlpha(f.file), clusterAlpha(f.cluster)));
      (spokes.get(key) ?? spokes.set(key, []).get(key)!).push([hp.x, hp.y, fp.x, fp.y]);
    }
    for (const c of visClusters) {
      if (!c.parent) continue;
      const a = this.clusterPos(c, t);
      const b = this.clusterPos(c.parent, t);
      const key = withAlpha(c.color, 0.3 * clusterAlpha(c));
      (spokes.get(key) ?? spokes.set(key, []).get(key)!).push([b.x, b.y, a.x, a.y]);
    }
    ctx.lineWidth = 1 / k;
    for (const [color, segs] of spokes) {
      ctx.beginPath();
      for (const [ax, ay, bx, by] of segs) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // ---- dependency lines ----------------------------------------------------------------------
    let edgesDrawn = 0;
    if (state.showAll) edgesDrawn += this.drawAllEdges(model, layout, state, vp, k, anyFocus, selFolderLink);
    else if (filters.cyclesOnly && !iso && !tracePath) {
      edgesDrawn += this.drawEdgeList(model, layout, [...model.cycleEdges].filter((e) => edgePassesFilters(e, filters, model)).map((e) => ({ e, color: RELATION_COLORS.cycle })), k, t);
    }
    if (iso) {
      // every relationship inside the isolated neighbourhood
      const inside: Array<{ e: Edge; color: string }> = [];
      for (const p of iso) for (const e of model.outgoing.get(p) ?? []) {
        if (e.to && e.status === 'resolved' && iso.has(e.to) && kindOk(e) && e.from !== selFile?.path && e.to !== selFile?.path) {
          inside.push({ e, color: model.cycleEdges.has(e) ? RELATION_COLORS.cycle : '#8EA2D8' });
        }
      }
      edgesDrawn += this.drawEdgeList(model, layout, inside, k, t);
    }
    if (selFile && relEdges.length && !tracePath) {
      edgesDrawn += this.drawEdgeList(model, layout, relEdges.map(({ e, dir }) => ({
        e, color: model.cycleEdges.has(e) ? RELATION_COLORS.cycle : dir === 'dep' ? RELATION_COLORS.dependency : RELATION_COLORS.dependent,
      })), k, t, true);
    }
    if (selLink) {
      const es = (model.outgoing.get(selLink.from) ?? []).filter((e) => e.to === selLink.to);
      if (es[0]) edgesDrawn += this.drawEdgeList(model, layout, [{ e: es[0], color: LINK_COLOR }], k, t, true, 2.6);
    }
    if (state.trace?.steps.length) {
      edgesDrawn += this.drawEdgeList(model, layout, state.trace.steps.map((e) => ({ e, color: TRACE_COLOR })), k, t, true, 2.4, true);
    }

    // ---- ghosts (collapsing nodes) --------------------------------------------------------------
    for (const g of this.ghosts) {
      const r = lerp(this.fileR(g.from.r), 0, t);
      if (r * k <= 0.2) continue;
      ctx.beginPath();
      ctx.arc(lerp(g.from.x, g.to.x, t), lerp(g.from.y, g.to.y, t), r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(g.color, 0.7 * (1 - t));
      ctx.fill();
    }

    // ---- hubs ----------------------------------------------------------------------------------
    const hovered = state.hovered;
    for (const c of clusters) {
      const p = this.clusterPos(c, t);
      if (p.r * k <= 0.5) continue;
      const a = clusterAlpha(c);
      ctx.globalAlpha = a;
      const g = glowSprite(c.color);
      ctx.drawImage(g, p.x - p.r * 2.4, p.y - p.r * 2.4, p.r * 4.8, p.r * 4.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 10, 26, 0.92)';
      ctx.fill();
      ctx.lineWidth = Math.max(1.4 / k, p.r * 0.09);
      ctx.strokeStyle = withAlpha(c.color, 0.95);
      ctx.stroke();
      if (!c.expanded) {
        // collapsed: dashed outer ring = "click to expand"
        ctx.setLineDash([4 / k, 4 / k]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 5 / k, 0, Math.PI * 2);
        ctx.lineWidth = 1.2 / k;
        ctx.strokeStyle = withAlpha(c.color, 0.7);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (p.r * k >= 7) drawFolderGlyph(ctx, p.x, p.y, p.r * 0.5, c.color);
      const isSelFolder = sel?.type === 'folder' && model.folderByPath.get(sel.path)?.path === c.key;
      const isHover = hovered?.type === 'folder' && hovered.path === c.key;
      if (isSelFolder || isHover) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + (isSelFolder ? 6 : 4) / k, 0, Math.PI * 2);
        ctx.lineWidth = (isSelFolder ? 2.5 : 1.5) / k;
        ctx.strokeStyle = isSelFolder ? '#FFFFFF' : 'rgba(234, 240, 255, 0.75)';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---- files ---------------------------------------------------------------------------------
    const showCycleRings = state.showAll || filters.cyclesOnly || anyFocus;
    let nodes = clusters.length;
    for (const f of visFiles) {
      const p = this.filePos(f, t);
      if (p.r * k <= 0.3) continue;
      nodes++;
      const a = fileAlpha(f.file);
      const external = isExternalPath(f.file.path);
      ctx.globalAlpha = a;
      if (p.r * k >= 2) ctx.drawImage(glowSprite(f.color), p.x - p.r * 2.6, p.y - p.r * 2.6, p.r * 5.2, p.r * 5.2);
      ctx.beginPath();
      if (external) {
        // external packages: diamonds, never confused with repository files
        ctx.moveTo(p.x, p.y - p.r * 1.25); ctx.lineTo(p.x + p.r * 1.25, p.y); ctx.lineTo(p.x, p.y + p.r * 1.25); ctx.lineTo(p.x - p.r * 1.25, p.y); ctx.closePath();
      } else ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = f.file.kind === 'code' || external ? withAlpha(f.color, 0.95) : withAlpha(f.color, 0.55);
      ctx.fill();
      if (!external && p.r * k >= 6) drawFileGlyph(ctx, p.x, p.y, p.r * 0.55);
      if (f.file.parseError && p.r * k >= 3) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 1.5 / k, 0, Math.PI * 2);
        ctx.setLineDash([2 / k, 2 / k]);
        ctx.lineWidth = 1 / k;
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (showCycleRings && model.cycleOf.has(f.file.path)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 2.5 / k, 0, Math.PI * 2);
        ctx.lineWidth = 1.6 / k;
        ctx.strokeStyle = RELATION_COLORS.cycle;
        ctx.stroke();
      }
      const sev = state.findings.get(f.file.path);
      if (sev && p.r * k >= 2.5) drawFindingBadge(ctx, p.x + p.r * 0.85, p.y - p.r * 0.85, Math.max(p.r * 0.8, 4.5 / k), SEVERITY_COLOR[sev]);
      const isSel = selFile?.path === f.file.path;
      const isHover = hovered?.type === 'file' && hovered.path === f.file.path;
      const inTrace = traceSet.has(f.file.path);
      if (isSel || isHover || inTrace || ((selFile || selLink) && related.has(f.file.path))) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + (isSel ? 4 : 3) / k, 0, Math.PI * 2);
        ctx.lineWidth = (isSel ? 2.4 : 1.5) / k;
        ctx.strokeStyle = isSel ? '#FFFFFF' : isHover ? 'rgba(234, 240, 255, 0.85)' : inTrace ? TRACE_COLOR : selLink ? LINK_COLOR : this.relationColor(model, selFile!, f.file.path);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---- labels (screen space) --------------------------------------------------------------------
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pinned: Array<{ f: LFile; strong: boolean; tag?: string }> = [];
    for (const f of visFiles) {
      const path = f.file.path;
      if (selFile?.path === path || (hovered?.type === 'file' && hovered.path === path)) pinned.push({ f, strong: true });
      else if (selLink && (selLink.from === path || selLink.to === path)) pinned.push({ f, strong: true });
      else if (tracePath && traceSet.has(path)) pinned.push({ f, strong: true, tag: `${tracePath.indexOf(path) + 1}` });
    }
    const labels = this.drawLabels(clusters, visFiles, t, related, !!(selFile || selLink), pinned, fileAlpha, clusterAlpha);

    this.stats.nodes = nodes;
    this.stats.edges = edgesDrawn;
    this.stats.labels = labels;
  }

  private relationColor(model: AtlasModel, selected: FileNode, other: string): string {
    const dep = (model.outgoing.get(selected.path) ?? []).find((e) => e.to === other);
    const back = (model.incoming.get(selected.path) ?? []).find((e) => e.from === other);
    if ((dep && model.cycleEdges.has(dep)) || (back && model.cycleEdges.has(back))) return RELATION_COLORS.cycle;
    return dep ? RELATION_COLORS.dependency : RELATION_COLORS.dependent;
  }

  /** Curved directional lines with arrowheads; endpoints use the visible anchor (file or collapsed folder). Registers each as clickable. */
  private drawEdgeList(model: AtlasModel, layout: AtlasLayout, list: Array<{ e: Edge; color: string }>, k: number, t: number, emphasise = false, width = 1.8, straight = false): number {
    const ctx = this.ctx;
    const folderOf = (p: string) => model.folderByPath.get(p);
    const seen = new Set<string>();
    let n = 0;
    for (const { e, color } of list) {
      const src = model.fileByPath.get(e.from);
      const dst = e.to ? model.fileByPath.get(e.to) : null;
      if (!src || !dst) continue;
      const a = visualAnchor(layout, src, folderOf);
      const b = visualAnchor(layout, dst, folderOf);
      if (!a || !b) continue;
      const pa = a.file ? this.filePos(a.file, t) : { x: a.x, y: a.y, r: this.hubR(a.r) };
      const pb = b.file ? this.filePos(b.file, t) : { x: b.x, y: b.y, r: this.hubR(b.r) };
      const key = `${pa.x},${pa.y}|${pb.x},${pb.y}|${color}`;
      if (seen.has(key)) continue; // several imports collapsed into the same folder anchor
      seen.add(key);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) continue;
      const bend = straight ? Math.min(0.08 * d, 60) : Math.min(0.22 * d, 160);
      const cx = (pa.x + pb.x) / 2 - (dy / d) * bend;
      const cy = (pa.y + pb.y) / 2 + (dx / d) * bend;
      const la = Math.hypot(cx - pa.x, cy - pa.y) || 1;
      const lb = Math.hypot(pb.x - cx, pb.y - cy) || 1;
      const sx = pa.x + ((cx - pa.x) / la) * (pa.r + 2 / k);
      const sy = pa.y + ((cy - pa.y) / la) * (pa.r + 2 / k);
      const ex = pb.x - ((pb.x - cx) / lb) * (pb.r + 3 / k);
      const ey = pb.y - ((pb.y - cy) / lb) * (pb.r + 3 / k);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      if (emphasise) {
        ctx.lineWidth = (width + 3.2) / k;
        ctx.strokeStyle = withAlpha(color, 0.18);
        ctx.stroke();
      }
      ctx.lineWidth = (emphasise ? width : 1.3) / k;
      ctx.strokeStyle = withAlpha(color, emphasise ? 0.95 : 0.75);
      ctx.stroke();
      const ang = Math.atan2(ey - cy, ex - cx);
      const s = (emphasise ? 8 : 6) / k;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - s * Math.cos(ang - 0.42), ey - s * Math.sin(ang - 0.42));
      ctx.lineTo(ex - s * Math.cos(ang + 0.42), ey - s * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fillStyle = withAlpha(color, emphasise ? 1 : 0.8);
      ctx.fill();
      // clickable geometry (sampled curve); only links whose ends are visible files (not collapsed folders)
      if (a.file && b.file) {
        const pts: number[] = [];
        for (let i = 0; i <= 12; i++) {
          const u = i / 12;
          pts.push((1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * ex, (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * ey);
        }
        this.addLink({ type: 'link', from: e.from, to: e.to! }, pts);
      }
      n++;
    }
    return n;
  }

  private addLink(hit: Hit, pts: number[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]); }
    this.drawnLinks.push({ hit, pts, minX, minY, maxX, maxY });
  }

  /** Show All: hierarchical bundles when zoomed in, folder-to-folder lines when zoomed out. */
  private drawAllEdges(model: AtlasModel, layout: AtlasLayout, state: ViewState, vp: { minX: number; minY: number; maxX: number; maxY: number }, k: number, dimmed: boolean, selFolderLink: { from: string; to: string } | null): number {
    const ctx = this.ctx;
    const fade = dimmed ? 0.35 : 1;
    if (k < AGGREGATE_ZOOM) {
      if (!this.aggregated || this.aggregatedFor !== state.filters) {
        this.aggregated = aggregateTopLevel(model, layout, state.filters);
        this.aggregatedFor = state.filters;
      }
      let n = 0;
      const max = Math.max(1, ...this.aggregated.map((x) => x.count));
      for (const { a, b, count, cycle } of this.aggregated) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const cx = (a.x + b.x) / 2 - (dy / d) * d * 0.12;
        const cy = (a.y + b.y) / 2 + (dx / d) * d * 0.12;
        const chosen = !!selFolderLink && selFolderLink.from === a.key && selFolderLink.to === b.key;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.lineWidth = (1 + 5 * Math.sqrt(count / max) + (chosen ? 2 : 0)) / k;
        ctx.strokeStyle = chosen ? LINK_COLOR : cycle ? withAlpha(RELATION_COLORS.cycle, 0.65 * fade) : withAlpha(RELATION_COLORS.dependency, (0.25 + 0.5 * (count / max)) * (selFolderLink ? 0.4 : fade));
        ctx.stroke();
        const pts: number[] = [];
        for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push((1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x, (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y); }
        this.addLink({ type: 'folderLink', from: a.key, to: b.key }, pts);
        n++;
      }
      return n;
    }
    if (!this.bundled) this.bundled = bundleEdges(model, layout);
    const { paths, bbox, edges } = this.bundled;
    let n = 0;
    const normal = new Path2D();
    const cyc = new Path2D();
    const registerLinks = paths.length <= 6000; // hit testing stays cheap
    for (let i = 0; i < paths.length; i++) {
      if (bbox[i * 4 + 2] < vp.minX || bbox[i * 4] > vp.maxX || bbox[i * 4 + 3] < vp.minY || bbox[i * 4 + 1] > vp.maxY) continue;
      const e = edges[i];
      if (!edgePassesFilters(e, state.filters, model)) continue;
      const target = model.cycleEdges.has(e) ? cyc : normal;
      const p = paths[i];
      target.moveTo(p[0], p[1]);
      if (p.length === 4) target.lineTo(p[2], p[3]);
      else {
        for (let j = 2; j < p.length - 2; j += 2) target.quadraticCurveTo(p[j], p[j + 1], (p[j] + p[j + 2]) / 2, (p[j + 1] + p[j + 3]) / 2);
        target.lineTo(p[p.length - 2], p[p.length - 1]);
      }
      if (registerLinks && layout.fileByPath.has(e.from) && layout.fileByPath.has(e.to!)) this.addLink({ type: 'link', from: e.from, to: e.to! }, Array.from(p));
      n++;
    }
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = withAlpha(RELATION_COLORS.dependency, 0.28 * fade);
    ctx.stroke(normal);
    ctx.lineWidth = 1.6 / k;
    ctx.strokeStyle = withAlpha(RELATION_COLORS.cycle, 0.85 * fade);
    ctx.stroke(cyc);
    return n;
  }

  /**
   * Labels. Ordinary labels are placed greedily without overlap; the placement does not depend on the hovered
   * item, so moving the mouse never reshuffles them. Pinned labels (selected, hovered, trace, link ends) are drawn
   * afterwards on a dark pill, on top.
   */
  private drawLabels(
    clusters: LCluster[], files: Set<LFile>, t: number, related: Set<string>, focusActive: boolean, pinned: Array<{ f: LFile; strong: boolean; tag?: string }>,
    fileAlpha: (f: FileNode) => number, clusterAlpha: (c: LCluster) => number
  ): number {
    const ctx = this.ctx;
    const k = this.cam.k;
    const occupied = new Set<number>();
    const CELL = 10;
    const tryPlace = (x: number, y: number, w: number, h: number) => {
      if (x + w < 0 || y + h < 0 || x > this.w || y > this.h) return false;
      const x0 = Math.floor(x / CELL), x1 = Math.floor((x + w) / CELL), y0 = Math.floor(y / CELL), y1 = Math.floor((y + h) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) if (occupied.has(i * 100003 + j)) return false;
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) occupied.add(i * 100003 + j);
      return true;
    };
    let count = 0;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (const c of clusters) {
      const p = this.clusterPos(c, t);
      const s = this.worldToScreen(p.x, p.y);
      const r = p.r * k;
      if (r > 3) tryPlace(s.x - r * 0.7, s.y - r * 0.7, r * 1.4, r * 1.4);
    }

    const pinnedSet = new Set(pinned.map((x) => x.f));
    const labelled = new Set<LFile>();
    const fileLabel = (f: LFile, emphasis: boolean) => {
      const p = this.filePos(f, t);
      const s = this.worldToScreen(p.x, p.y);
      ctx.font = `${emphasis ? 600 : 500} 11px Inter, system-ui, sans-serif`;
      const w = ctx.measureText(f.file.name).width;
      const gap = p.r * k + 5;
      const spots: Array<[number, number]> = [[s.x + gap, s.y], [s.x - gap - w, s.y], [s.x - w / 2, s.y + gap + 6], [s.x - w / 2, s.y - gap - 6]];
      const spot = spots.find(([x, y]) => tryPlace(x - 2, y - 7, w + 4, 14));
      if (!spot) return;
      ctx.globalAlpha = Math.max(0.25, fileAlpha(f.file));
      ctx.fillStyle = emphasis ? '#FFFFFF' : '#C8D3EA';
      ctx.fillText(f.file.name, spot[0], spot[1]);
      ctx.globalAlpha = 1;
      labelled.add(f);
      count++;
    };

    // 1. related files of the selection (stable while the selection lasts)
    if (focusActive) for (const f of files) if (!pinnedSet.has(f) && related.has(f.file.path)) fileLabel(f, true);
    // 2. hubs, biggest first
    const hubs = clusters.filter((c) => !c.isRootFiles || c.folder.files.length).sort((a, b) => b.hubR - a.hubR);
    for (const c of hubs) {
      const p = this.clusterPos(c, t);
      const r = p.r * k;
      if (r < 6 && c.depth > 1) continue;
      const s = this.worldToScreen(p.x, p.y);
      const name = c.isRootFiles ? `${c.folder.name} (root files)` : c.folder.name;
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      const w1 = ctx.measureText(name).width;
      const fileCount = c.isRootFiles ? c.folder.files.length : c.folder.totalFiles;
      const sub = `${fileCount} file${fileCount === 1 ? '' : 's'}${c.expanded ? '' : ' · collapsed'}`;
      ctx.font = '400 10px Inter, system-ui, sans-serif';
      const w2 = ctx.measureText(sub).width;
      const w = Math.max(w1, w2);
      const y = s.y + r + 4;
      if (!tryPlace(s.x - w / 2 - 3, y, w + 6, 28)) continue;
      ctx.globalAlpha = Math.max(0.3, clusterAlpha(c));
      ctx.textAlign = 'center';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#F3F6FF';
      ctx.fillText(name, s.x, y + 7);
      ctx.font = '400 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#A7B4CC';
      ctx.fillText(sub, s.x, y + 21);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      count++;
    }
    // 3. other files when zoomed in enough
    if (k >= FILE_LABEL_ZOOM) for (const f of files) if (!labelled.has(f) && !pinnedSet.has(f)) fileLabel(f, false);

    // 4. pinned labels on a pill, on top (they never displace the labels above)
    for (const { f, strong, tag } of pinned) {
      const p = this.filePos(f, t);
      const s = this.worldToScreen(p.x, p.y);
      const text = tag ? `${tag}. ${f.file.name}` : f.file.name;
      ctx.font = `${strong ? 600 : 500} 11.5px Inter, system-ui, sans-serif`;
      const w = ctx.measureText(text).width;
      const x = s.x + p.r * k + 7;
      roundRect(ctx, x - 5, s.y - 10, w + 10, 20, 6);
      ctx.fillStyle = 'rgba(5, 9, 22, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(135, 155, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(text, x, s.y);
      count++;
    }
    return count;
  }

  // ------------------------------------------------------------------------------------------------
  // Minimap
  // ------------------------------------------------------------------------------------------------
  drawMinimap(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.layout) return;
    const dpr = this.dpr;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const b = this.layout.bounds;
    const s = Math.min(W / (b.maxX - b.minX), H / (b.maxY - b.minY)) * 0.9;
    const ox = W / 2 - ((b.minX + b.maxX) / 2) * s;
    const oy = H / 2 - ((b.minY + b.maxY) / 2) * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const c of this.layout.clusters) {
      if (c.depth > 2) continue;
      ctx.beginPath();
      ctx.arc((c.expanded ? c.cx : c.x) * s + ox, (c.expanded ? c.cy : c.y) * s + oy, Math.max(1.5, (c.expanded ? c.r : c.hubR) * s), 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(c.color, c.depth <= 1 ? 0.35 : 0.5);
      ctx.fill();
    }
    const v = this.viewport;
    ctx.strokeStyle = 'rgba(234, 240, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(v.minX * s + ox, v.minY * s + oy, (v.maxX - v.minX) * s, (v.maxY - v.minY) * s);
  }

  /** Centre the camera on a minimap point. */
  minimapTo(canvas: HTMLCanvasElement, mx: number, my: number) {
    if (!this.layout) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const b = this.layout.bounds;
    const s = Math.min(W / (b.maxX - b.minX), H / (b.maxY - b.minY)) * 0.9;
    const ox = W / 2 - ((b.minX + b.maxX) / 2) * s;
    const oy = H / 2 - ((b.minY + b.maxY) / 2) * s;
    this.camAnim = null;
    this.zoomGoal = null;
    this.cam = { ...this.cam, x: (mx - ox) / s, y: (my - oy) / s };
    this.onCamera?.();
    this.invalidate();
  }
}

// --------------------------------------------------------------------------------------------------
// Edge geometry helpers (pure; exported for tests)
// --------------------------------------------------------------------------------------------------
function topOf(c: LCluster): LCluster {
  let x = c;
  while (x.parent) x = x.parent;
  return x;
}

/** Distance from a point to a polyline given as [x0,y0,x1,y1,...]. */
export function distToPolyline(px: number, py: number, pts: ArrayLike<number>): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + u * dx), py - (ay + u * dy)));
  }
  return best;
}

/** Resolved edges merged into top-level folder pairs (used when zoomed out). */
export function aggregateTopLevel(model: AtlasModel, layout: AtlasLayout, filters?: AtlasFilters) {
  const folderOf = (p: string) => model.folderByPath.get(p);
  const pairs = new Map<string, { a: LCluster; b: LCluster; count: number; cycle: boolean }>();
  for (const e of model.data.edges) {
    if (e.status !== 'resolved' || !e.to) continue;
    if (filters && !edgePassesFilters(e, filters, model)) continue;
    const a = visualAnchor(layout, model.fileByPath.get(e.from)!, folderOf);
    const b = visualAnchor(layout, model.fileByPath.get(e.to)!, folderOf);
    if (!a?.cluster || !b?.cluster) continue;
    const ta = topOf(a.cluster), tb = topOf(b.cluster);
    if (ta === tb) continue;
    const key = `${ta.key}\u0000${tb.key}`;
    const x = pairs.get(key) ?? pairs.set(key, { a: ta, b: tb, count: 0, cycle: false }).get(key)!;
    x.count++;
    if (model.cycleEdges.has(e)) x.cycle = true;
  }
  return [...pairs.values()];
}

/** Top-level folder key (as used by the layout) of a file path. */
export function topFolderKey(model: AtlasModel, path: string): string {
  let f = model.folderByPath.get(model.fileByPath.get(path)?.folder ?? '') ?? null;
  if (!f || f === model.root) return model.root.path;
  while (f.parent && f.parent !== model.root) f = f.parent;
  return f.path;
}

/** All resolved edges from one top-level folder to another (layout keys). */
export function edgesBetweenTopFolders(model: AtlasModel, from: string, to: string): Edge[] {
  return model.data.edges.filter((e) => e.status === 'resolved' && e.to && topFolderKey(model, e.from) === from && topFolderKey(model, e.to) === to);
}

/**
 * Hierarchical edge bundling: each resolved edge is routed through the hubs of its folder chain
 * (source cluster up to below the common ancestor, then down to the target cluster) and straightened a little.
 */
export function bundleEdges(model: AtlasModel, layout: AtlasLayout, beta = 0.82) {
  const folderOf = (p: string) => model.folderByPath.get(p);
  const paths: Float32Array[] = [];
  const edges: Edge[] = [];
  const boxes: number[] = [];
  for (const e of model.data.edges) {
    if (e.status !== 'resolved' || !e.to) continue;
    const a = visualAnchor(layout, model.fileByPath.get(e.from)!, folderOf);
    const b = visualAnchor(layout, model.fileByPath.get(e.to)!, folderOf);
    if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
    const up: LCluster[] = [];
    const down: LCluster[] = [];
    const bChain = new Set<LCluster>();
    for (let c = b.cluster; c; c = c.parent) bChain.add(c);
    let lca: LCluster | null = null;
    for (let c = a.cluster; c; c = c.parent) { if (bChain.has(c)) { lca = c; break; } up.push(c); }
    for (let c = b.cluster; c && c !== lca; c = c.parent) down.unshift(c);
    const ctrl: number[] = [a.x, a.y];
    for (const c of [...up, ...down]) ctrl.push(c.x, c.y);
    if (lca && up.length + down.length === 0 && (a.file || b.file)) ctrl.push(lca.x, lca.y);
    ctrl.push(b.x, b.y);
    const n = ctrl.length / 2 - 1;
    const out = new Float32Array(ctrl.length);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i <= n; i++) {
      const tt = n ? i / n : 0;
      const x = beta * ctrl[i * 2] + (1 - beta) * (a.x + (b.x - a.x) * tt);
      const y = beta * ctrl[i * 2 + 1] + (1 - beta) * (a.y + (b.y - a.y) * tt);
      out[i * 2] = x; out[i * 2 + 1] = y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    paths.push(out);
    edges.push(e);
    boxes.push(minX, minY, maxX, maxY);
  }
  return { paths, bbox: new Float32Array(boxes), edges };
}

// --------------------------------------------------------------------------------------------------
// Glyphs
// --------------------------------------------------------------------------------------------------
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Warning triangle: architectural finding (distinct shape from the red cycle ring). */
function drawFindingBadge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.95, y + s * 0.7);
  ctx.lineTo(x - s * 0.95, y + s * 0.7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = s * 0.22;
  ctx.strokeStyle = 'rgba(5, 9, 22, 0.9)';
  ctx.stroke();
}

function drawFolderGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.beginPath();
  const w = s * 1.6, h = s * 1.15;
  const l = x - w / 2, t = y - h / 2;
  ctx.moveTo(l, t + h * 0.18);
  ctx.lineTo(l + w * 0.38, t + h * 0.18);
  ctx.lineTo(l + w * 0.46, t);
  ctx.lineTo(l, t);
  ctx.closePath();
  ctx.rect(l, t + h * 0.18, w, h * 0.82);
  ctx.fillStyle = withAlpha(color, 0.9);
  ctx.fill();
}

function drawFileGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const w = s * 1.25, h = s * 1.6;
  const l = x - w / 2, t = y - h / 2, f = w * 0.35;
  ctx.beginPath();
  ctx.moveTo(l, t);
  ctx.lineTo(l + w - f, t);
  ctx.lineTo(l + w, t + f);
  ctx.lineTo(l + w, t + h);
  ctx.lineTo(l, t + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(6, 10, 26, 0.55)';
  ctx.fill();
}
