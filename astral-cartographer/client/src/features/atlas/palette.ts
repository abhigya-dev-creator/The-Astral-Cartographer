/**
 * Folder colours. The base entries come from the app's design tokens (read at runtime, with the same
 * values as fallbacks); three extra hues are atlas-only. Red is NOT in the palette: it means "circular dependency".
 */
const TOKEN_COLORS: Array<[cssVar: string, fallback: string]> = [
  ['--color-blue', '#386BFF'],
  ['--color-violet', '#8B78FF'],
  ['--color-cyan', '#37D9FF'],
  ['--color-green', '#43D9A3'],
  ['--color-amber', '#FFD166'],
  ['--color-orange', '#FFAD66'],
  ['--color-stellar-peach', '#DDB39C'],
];
const EXTRA_COLORS = ['#F06BD8' /* pink */, '#B8E35A' /* lime */, '#C77DFF' /* purple */];

/** Selection colours (fixed meaning across 2D and 3D). */
export const RELATION_COLORS = {
  dependency: '#4F8BFF',
  dependent: '#FFAD66',
  cycle: '#FF717A',
  unresolved: '#77839C',
} as const;

/**
 * Isolate mode: neighbours get their own bright colours instead of their folder colour, so they stand out
 * against the (mostly blue) folders around them. None of these is blue or red.
 */
export const ISOLATE_COLORS = {
  /** the isolated file itself */
  anchor: '#F4F7FF',
  /** files the isolated file imports */
  uses: '#3DF5C4',
  /** files that import the isolated file */
  usedBy: '#FFAD66',
  /** files 2 or 3 steps away */
  further: '#F06BD8',
  /** lines between neighbours (not involving the isolated file) */
  line: '#C8D3FF',
} as const;

let cached: string[] | null = null;

export function folderPalette(): string[] {
  if (cached) return cached;
  let style: CSSStyleDeclaration | null = null;
  try {
    style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  } catch {
    style = null;
  }
  cached = [...TOKEN_COLORS.map(([v, fb]) => style?.getPropertyValue(v).trim() || fb), ...EXTRA_COLORS];
  return cached;
}

/** Stable 32-bit FNV-1a hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Assign each top-level folder a palette index.
 * - Preferred colour = hash(folder name) mod palette size, so the same name gets the same colour in every repo.
 * - Collisions are resolved deterministically by probing the next index; folders are processed by (hash, name).
 * - With at most `palette size` folders every colour is unique; with more, a folder must differ from the
 *   folders it touches (`neighbours`) and takes the least-used allowed colour, so colours stay spread out.
 */
export function assignFolderColors(names: string[], neighbours: Map<string, Set<string>>, size: number): Map<string, number> {
  const order = [...names].sort((a, b) => hashString(a) - hashString(b) || (a < b ? -1 : a > b ? 1 : 0));
  const unique = names.length <= size;
  const usage = new Array<number>(size).fill(0);
  const out = new Map<string, number>();
  for (const name of order) {
    const preferred = hashString(name) % size;
    const blocked = new Set<number>();
    if (unique) usage.forEach((u, c) => { if (u > 0) blocked.add(c); });
    else for (const n of neighbours.get(name) ?? []) if (out.has(n)) blocked.add(out.get(n)!);
    let chosen = -1;
    // probe from the hashed colour; among allowed colours take the least used (first in probe order on ties)
    for (let k = 0; k < size; k++) {
      const c = (preferred + k) % size;
      if (blocked.has(c)) continue;
      if (chosen === -1 || usage[c] < usage[chosen]) chosen = c;
    }
    if (chosen === -1) chosen = preferred; // every colour blocked (more neighbours than colours)
    out.set(name, chosen);
    usage[chosen]++;
  }
  return out;
}

/** `#rrggbb` -> `rgba(r,g,b,a)` */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
