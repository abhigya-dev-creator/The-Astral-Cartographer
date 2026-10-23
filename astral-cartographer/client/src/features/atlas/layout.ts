import type { FileNode, FolderNode } from './model';
import { assignFolderColors, folderPalette } from './palette';

/** World units (1 unit = 1 CSS pixel at zoom 1). */
export const GEOM = { FILE_R: 6, GAP: 10, RING_GAP: 14, PAD: 18, TOP_MARGIN: 34, BLOB_SAMPLES: 72, BLOB_PAD: 12 };
export const ROOT_FILES_COLOR = '#A7B4CC';

export function hubRadius(folder: FolderNode): number {
  const base = Math.min(44, 13 + 3.4 * Math.log2(1 + folder.totalFiles));
  return folder.depth <= 1 ? base : base * Math.max(0.62, 1 - 0.13 * (folder.depth - 1));
}

// ------------------------------------------------------------------------------------------------
// Relative (per-cluster) layout, cached so only changed clusters are recomputed
// ------------------------------------------------------------------------------------------------
type RelChild =
  | { kind: 'file'; file: FileNode; dx: number; dy: number; r: number }
  | { kind: 'folder'; folder: FolderNode; rel: RelLayout; dx: number; dy: number; r: number };

export interface RelLayout {
  folder: FolderNode;
  expanded: boolean;
  filesOnly: boolean;
  /** radius of the circle enclosing the whole cluster (hub + children + padding) */
  r: number;
  /** centre of that enclosing circle relative to the hub: a large child pulls it off the hub */
  ox: number;
  oy: number;
  hubR: number;
  children: RelChild[];
  /** subfolder layouts this result was built from (cache validation) */
  childRels: RelLayout[];
  /** blob outline, relative, flat [x0,y0,x1,y1,...]; null when collapsed */
  blob: number[] | null;
}

export type LayoutCache = Map<string, RelLayout>;

const TAU = Math.PI * 2;

function relLayout(folder: FolderNode, expanded: ReadonlySet<string>, cache: LayoutCache, filesOnly = false): RelLayout {
  const key = filesOnly ? `${folder.path}\u0000files` : folder.path;
  const isExpanded = filesOnly || expanded.has(folder.path);
  const prev = cache.get(key);
  const hubR = hubRadius(folder);

  if (!isExpanded) {
    if (prev && !prev.expanded) return prev;
    const collapsed: RelLayout = { folder, expanded: false, filesOnly, r: hubR + GEOM.PAD * 0.6, ox: 0, oy: 0, hubR, children: [], childRels: [], blob: null };
    cache.set(key, collapsed);
    return collapsed;
  }

  const childRels = filesOnly ? [] : folder.folders.map((f) => relLayout(f, expanded, cache));
  if (prev && prev.expanded && prev.childRels.length === childRels.length && prev.childRels.every((c, i) => c === childRels[i])) return prev;

  // Items: files first (inner rings), then subfolder clusters. The order uses the folder's file count, which does
  // not change when a folder is expanded or collapsed, so siblings never swap places on a toggle.
  type Item = { kind: 'file'; file: FileNode; r: number } | { kind: 'folder'; folder: FolderNode; rel: RelLayout; r: number };
  const items: Item[] = [
    ...folder.files.map((file) => ({ kind: 'file' as const, file, r: GEOM.FILE_R })),
    ...childRels
      .map((rel) => ({ kind: 'folder' as const, folder: rel.folder, rel, r: rel.r }))
      .sort((a, b) => b.folder.totalFiles - a.folder.totalFiles || (a.folder.name < b.folder.name ? -1 : 1)),
  ];

  const children: RelChild[] = [];
  let inner = hubR;
  let ringIndex = 0;
  let i = 0;
  const arc = (r: number, R: number) => 2 * Math.asin(Math.min(1, (r + GEOM.GAP / 2) / R));
  while (i < items.length) {
    // The ring radius is set by the largest item on it, so no item can reach into the inner ring.
    const members: Item[] = [];
    let maxOnRing = 0;
    let R = 0;
    let sum = 0;
    while (i < items.length) {
      const it = items[i];
      if (members.length && it.kind !== members[0].kind) break; // files and folders never share a ring
      const candMax = Math.max(maxOnRing, it.r);
      const candR = inner + GEOM.RING_GAP + candMax;
      const candSum = candMax === maxOnRing && members.length ? sum + arc(it.r, candR) : [...members, it].reduce((s, x) => s + arc(x.r, candR), 0);
      if (members.length && candSum > TAU) break;
      members.push(it);
      maxOnRing = candMax;
      R = candR;
      sum = candSum;
      i++;
    }
    const ring = members.map((item) => ({ item, a: arc(item.r, R) }));
    const extra = (TAU - sum) / ring.length;
    let angle = -Math.PI / 2 + ringIndex * 0.61;
    let maxR = 0;
    for (const { item, a } of ring) {
      const mid = angle + a / 2;
      // the ring position is the centre of the child's enclosing circle; its hub sits at that minus its offset
      const px = R * Math.cos(mid);
      const py = R * Math.sin(mid);
      children.push(item.kind === 'file'
        ? { kind: 'file', file: item.file, dx: px, dy: py, r: item.r }
        : { kind: 'folder', folder: item.folder, rel: item.rel, dx: px - item.rel.ox, dy: py - item.rel.oy, r: item.r });
      angle += a + extra;
      maxR = Math.max(maxR, item.r);
    }
    inner = R + maxR;
    ringIndex++;
  }

  const circles = [{ x: 0, y: 0, r: hubR }, ...children.map(childCircle)];
  const enc = enclosingCircle(circles);
  const result: RelLayout = {
    folder, expanded: true, filesOnly, r: enc.r + GEOM.PAD, ox: enc.x, oy: enc.y, hubR, children, childRels, blob: blobOutline(hubR, children),
  };
  cache.set(key, result);
  return result;
}

/** A child's footprint: files are their own circle; folders are their enclosing circle. */
function childCircle(c: RelChild): { x: number; y: number; r: number } {
  return c.kind === 'file' ? { x: c.dx, y: c.dy, r: c.r } : { x: c.dx + c.rel.ox, y: c.dy + c.rel.oy, r: c.r };
}

/**
 * Small circle enclosing a set of circles (Badoiu–Clarkson iterations from the bounding-box centre).
 * Deterministic; within a few percent of the minimum, and always a true enclosure (radius is measured, not estimated).
 */
export function enclosingCircle(cs: Array<{ x: number; y: number; r: number }>): { x: number; y: number; r: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cs) { minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r); minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r); }
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const reach = (x: number, y: number) => {
    let best = 0, far = cs[0];
    for (const c of cs) { const d = Math.hypot(c.x - x, c.y - y) + c.r; if (d > best) { best = d; far = c; } }
    return { d: best, far };
  };
  let best = { x: cx, y: cy, r: reach(cx, cy).d };
  for (let i = 1; i <= 60; i++) {
    const { far } = reach(cx, cy);
    const len = Math.hypot(far.x - cx, far.y - cy) || 1;
    // step towards the farthest circle's far edge
    const tx = far.x + ((far.x - cx) / len) * far.r, ty = far.y + ((far.y - cy) / len) * far.r;
    cx += (tx - cx) / (i + 1);
    cy += (ty - cy) / (i + 1);
    const d = reach(cx, cy).d;
    if (d < best.r) best = { x: cx, y: cy, r: d };
  }
  return best;
}

/** Soft outline: support function of hub + children sampled in polar directions, padded and smoothed. */
function blobOutline(hubR: number, children: RelChild[]): number[] {
  const n = GEOM.BLOB_SAMPLES;
  const radii = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const t = (k / n) * TAU;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    let best = hubR;
    for (const ch of children) {
      const c = childCircle(ch);
      const s = c.x * ux + c.y * uy + c.r;
      if (s > best) best = s;
    }
    radii[k] = best + GEOM.BLOB_PAD;
  }
  const smooth = radii.map((_, k) => {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += radii[(k + j + n) % n];
    return s / 7;
  });
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * TAU;
    out.push(smooth[k] * Math.cos(t), smooth[k] * Math.sin(t));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Top-level packing (deterministic, no overlap)
// ------------------------------------------------------------------------------------------------
export interface PackItem { key: string; r: number }

export function packCircles(items: PackItem[]): Map<string, { x: number; y: number }> {
  const sorted = [...items].sort((a, b) => b.r - a.r || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const placed: Array<{ key: string; x: number; y: number; r: number }> = [];
  const fits = (x: number, y: number, r: number) => {
    for (const p of placed) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < (p.r + r) * (p.r + r) - 1e-6) return false;
    }
    return true;
  };

  for (const it of sorted) {
    if (!placed.length) { placed.push({ key: it.key, x: 0, y: 0, r: it.r }); continue; }
    let best: { x: number; y: number; d: number } | null = null;
    const consider = (x: number, y: number) => {
      const d = x * x + y * y;
      if ((!best || d < best.d - 1e-9) && fits(x, y, it.r)) best = { x, y, d };
    };
    if (placed.length <= 80) {
      // tangent to two placed circles
      for (let a = 0; a < placed.length; a++) {
        for (let b = a + 1; b < placed.length; b++) {
          const A = placed[a];
          const B = placed[b];
          const ra = A.r + it.r;
          const rb = B.r + it.r;
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d2 = dx * dx + dy * dy;
          const d = Math.sqrt(d2);
          if (d > ra + rb || d < Math.abs(ra - rb) || d === 0) continue;
          const l = (ra * ra - rb * rb + d2) / (2 * d);
          const h = Math.sqrt(Math.max(0, ra * ra - l * l));
          const mx = A.x + (dx * l) / d;
          const my = A.y + (dy * l) / d;
          consider(mx + (h * dy) / d, my - (h * dx) / d);
          consider(mx - (h * dy) / d, my + (h * dx) / d);
        }
      }
      // tangent to one placed circle (always has a solution)
      if (!best) for (const p of placed) for (let k = 0; k < 12; k++) consider(p.x + (p.r + it.r) * Math.cos((k * TAU) / 12), p.y + (p.r + it.r) * Math.sin((k * TAU) / 12));
    }
    if (!best) {
      // large repositories: walk an outward spiral until the circle fits
      const step = Math.max(4, it.r / 3);
      for (let t = 0; !best; t += 0.15) {
        const rr = step * t;
        consider(rr * Math.cos(t), rr * Math.sin(t));
      }
    }
    const b = best as unknown as { x: number; y: number };
    placed.push({ key: it.key, x: b.x, y: b.y, r: it.r });
  }
  return new Map(placed.map((p) => [p.key, { x: p.x, y: p.y }]));
}

/**
 * Keep the previous top-level positions and only resolve overlaps (deterministic for a given previous layout).
 * A cluster whose size changed stays where it is; overlapping neighbours move away along the line between centres.
 * Returns null (=> full re-pack) when the cluster set changed or overlaps cannot be resolved.
 */
function stablePack(items: PackItem[], prev: AtlasLayout): Map<string, { x: number; y: number }> | null {
  if (items.length > 150) return null;
  const pos = items.map((it) => {
    const c = prev.clusterByPath.get(it.key);
    return c && !c.parent ? { key: it.key, x: c.cx, y: c.cy, r: it.r, grew: Math.abs(c.r + GEOM.TOP_MARGIN / 2 - it.r) > 0.5 } : null;
  });
  if (pos.some((p) => p === null)) return null;
  const ps = pos as Array<{ key: string; x: number; y: number; r: number; grew: boolean }>;
  ps.sort((a, b) => (a.key < b.key ? -1 : 1));
  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const need = a.r + b.r;
        if (d >= need - 1e-6) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        const push = need - d + 0.01;
        const ux = dx / d, uy = dy / d;
        // the cluster that changed size is the anchor; otherwise both give way equally
        const wa = a.grew && !b.grew ? 0 : b.grew && !a.grew ? 1 : 0.5;
        a.x -= ux * push * wa; a.y -= uy * push * wa;
        b.x += ux * push * (1 - wa); b.y += uy * push * (1 - wa);
        moved = true;
      }
    }
    if (!moved) return new Map(ps.map((p) => [p.key, { x: p.x, y: p.y }]));
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Absolute layout
// ------------------------------------------------------------------------------------------------
export interface LCluster {
  /** folder path; '' + isRootFiles for files at the repository root */
  key: string;
  folder: FolderNode;
  /** hub position */
  x: number;
  y: number;
  /** enclosing circle of the whole cluster (may be off the hub when one child is large) */
  cx: number;
  cy: number;
  r: number;
  hubR: number;
  expanded: boolean;
  isRootFiles: boolean;
  color: string;
  depth: number;
  parent: LCluster | null;
  blob: number[] | null;
}

export interface LFile {
  file: FileNode;
  x: number;
  y: number;
  r: number;
  color: string;
  cluster: LCluster;
}

export interface AtlasLayout {
  clusters: LCluster[];
  files: LFile[];
  clusterByPath: Map<string, LCluster>;
  fileByPath: Map<string, LFile>;
  colorByTop: Map<string, string>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Lay out the repository.
 * Without `prev` the result is a pure function of (tree, expanded): the same repository always gives the same picture.
 * With `prev` (an expand/collapse of the same model) top-level clusters keep their positions and colours; only
 * overlaps caused by a cluster that grew are resolved, so unrelated parts of the map do not jump.
 */
export function computeLayout(root: FolderNode, expanded: ReadonlySet<string>, cache: LayoutCache = new Map(), prev: AtlasLayout | null = null): AtlasLayout {
  const tops: Array<{ key: string; rel: RelLayout; folder: FolderNode; isRootFiles: boolean }> = root.folders.map((f) => ({
    key: f.path, rel: relLayout(f, expanded, cache), folder: f, isRootFiles: false,
  }));
  if (root.files.length) tops.push({ key: root.path, rel: relLayout(root, expanded, cache, true), folder: root, isRootFiles: true });

  const items = tops.map((t) => ({ key: t.key, r: t.rel.r + GEOM.TOP_MARGIN / 2 }));
  const positions = (prev && stablePack(items, prev)) || packCircles(items);

  // colours: hash of the top-level folder name, neighbours (touching clusters) must differ
  const names = tops.filter((t) => !t.isRootFiles).map((t) => t.folder.name);
  const neighbours = new Map<string, Set<string>>();
  for (const a of tops) for (const b of tops) {
    if (a === b || a.isRootFiles || b.isRootFiles) continue;
    const pa = positions.get(a.key)!;
    const pb = positions.get(b.key)!;
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= a.rel.r + b.rel.r + GEOM.TOP_MARGIN * 1.5) {
      (neighbours.get(a.folder.name) ?? neighbours.set(a.folder.name, new Set()).get(a.folder.name)!).add(b.folder.name);
    }
  }
  const palette = folderPalette();
  const idx = assignFolderColors(names, neighbours, palette.length);
  // incremental updates keep every existing folder's colour; only new top-level folders get one assigned
  const colorByTop = new Map<string, string>(names.map((n) => [n, prev?.colorByTop.get(n) ?? palette[idx.get(n)!]]));

  const clusters: LCluster[] = [];
  const files: LFile[] = [];
  const clusterByPath = new Map<string, LCluster>();
  const fileByPath = new Map<string, LFile>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const place = (rel: RelLayout, x: number, y: number, parent: LCluster | null, color: string, isRootFiles: boolean) => {
    const c: LCluster = {
      key: rel.folder.path, folder: rel.folder, x, y, cx: x + rel.ox, cy: y + rel.oy, r: rel.r, hubR: rel.hubR, expanded: rel.expanded, isRootFiles,
      color, depth: rel.folder.depth, parent, blob: null,
    };
    if (rel.blob) {
      c.blob = new Array(rel.blob.length);
      for (let k = 0; k < rel.blob.length; k += 2) { c.blob[k] = rel.blob[k] + x; c.blob[k + 1] = rel.blob[k + 1] + y; }
    }
    clusters.push(c);
    clusterByPath.set(c.key, c);
    minX = Math.min(minX, c.cx - rel.r); maxX = Math.max(maxX, c.cx + rel.r);
    minY = Math.min(minY, c.cy - rel.r); maxY = Math.max(maxY, c.cy + rel.r);
    for (const ch of rel.children) {
      if (ch.kind === 'file') {
        const lf: LFile = { file: ch.file, x: x + ch.dx, y: y + ch.dy, r: ch.r, color, cluster: c };
        files.push(lf);
        fileByPath.set(ch.file.path, lf);
      } else {
        place(ch.rel, x + ch.dx, y + ch.dy, c, color, false);
      }
    }
  };

  for (const t of tops) {
    // packing positions are enclosing-circle centres; the hub sits at that minus the cluster's offset
    const p = positions.get(t.key)!;
    place(t.rel, p.x - t.rel.ox, p.y - t.rel.oy, null, t.isRootFiles ? ROOT_FILES_COLOR : colorByTop.get(t.folder.name)!, t.isRootFiles);
  }
  if (!clusters.length) { minX = minY = -100; maxX = maxY = 100; }
  return { clusters, files, clusterByPath, fileByPath, colorByTop, bounds: { minX, minY, maxX, maxY } };
}

/** Where a file is drawn: itself if visible, otherwise its nearest visible (collapsed) ancestor cluster. */
export function visualAnchor(layout: AtlasLayout, file: FileNode, folderOf: (path: string) => FolderNode | undefined): { x: number; y: number; r: number; file: LFile | null; cluster: LCluster | null } | null {
  const lf = layout.fileByPath.get(file.path);
  if (lf) return { x: lf.x, y: lf.y, r: lf.r, file: lf, cluster: lf.cluster };
  for (let f = folderOf(file.folder) ?? null; f; f = f.parent) {
    const c = layout.clusterByPath.get(f.path);
    if (c && !c.isRootFiles) return { x: c.x, y: c.y, r: c.hubR, file: null, cluster: c };
  }
  return null;
}
