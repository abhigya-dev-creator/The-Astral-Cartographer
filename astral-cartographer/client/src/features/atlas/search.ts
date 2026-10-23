import { allFolders, type AtlasModel } from './model';

export type SearchKind = 'file' | 'folder' | 'function' | 'class' | 'method';

export interface SearchEntry {
  kind: SearchKind;
  name: string;
  /** file path (for files and symbols) or folder path */
  path: string;
  /** symbol line, when kind is function/class/method */
  line?: number;
  lower: string;
}

export interface SearchResult extends SearchEntry {
  /** 0 exact, 1 prefix, 2 word start, 3 substring, 4 path substring, 5 typo */
  tier: number;
}

const KIND_ORDER: Record<SearchKind, number> = { file: 0, folder: 1, class: 2, function: 3, method: 4 };

export function buildSearchIndex(model: AtlasModel): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const f of model.data.files) {
    out.push({ kind: 'file', name: f.name, path: f.path, lower: f.name.toLowerCase() });
    for (const fn of f.functions) out.push({ kind: fn.kind, name: fn.name, path: f.path, line: fn.line, lower: fn.name.toLowerCase() });
  }
  for (const folder of allFolders(model.root)) {
    if (folder === model.root) continue;
    const last = folder.name.split('/').pop()!;
    out.push({ kind: 'folder', name: folder.name, path: folder.path, lower: last.toLowerCase() });
  }
  return out;
}

/** Optimal-string-alignment distance with an upper bound (returns bound + 1 when exceeded). */
export function boundedDistance(a: string, b: string, bound: number): number {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  const n = a.length, m = b.length;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > bound) return bound + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

const isWordStart = (s: string, i: number) => i === 0 || /[^a-z0-9]/.test(s[i - 1]) || (s[i - 1] !== s[i - 1].toUpperCase() && s[i] === s[i].toUpperCase());

export function search(index: SearchEntry[], query: string, limit = 30): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const bound = q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2;
  const results: SearchResult[] = [];
  for (const e of index) {
    let tier = -1;
    if (e.lower === q || e.lower.replace(/\.[^.]+$/, '') === q) tier = 0;
    else if (e.lower.startsWith(q)) tier = 1;
    else {
      const at = e.lower.indexOf(q);
      if (at > 0) tier = isWordStart(e.name, at) ? 2 : 3;
      else if (e.path.toLowerCase().includes(q)) tier = 4;
      else if (bound > 0) {
        // typo tolerance against the whole name and against a same-length prefix ("buton" -> "button.tsx")
        const stem = e.lower.replace(/\.[^.]+$/, '');
        if (boundedDistance(q, stem, bound) <= bound || boundedDistance(q, e.lower.slice(0, q.length), bound) <= bound) tier = 5;
      }
    }
    if (tier >= 0) results.push({ ...e, tier });
  }
  results.sort((a, b) => a.tier - b.tier || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.length - b.name.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0)));
  return results.slice(0, limit);
}
