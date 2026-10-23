import type { AtlasData, Edge, FileNode } from './model';

/**
 * Optional view: external packages as nodes.
 * The analysis records imports of npm packages and built-in modules as `external` edges without a target file.
 * This turns each distinct package into a virtual node inside one top-level folder and points those imports at it.
 * Virtual nodes are always recognisable (path prefix + `reason`), never counted as repository files, and the
 * original AtlasData is not modified.
 */
export const EXTERNAL_ROOT = 'External packages';
const PREFIX = `${EXTERNAL_ROOT}/`;
export const EXTERNAL_REASON = 'external package (virtual node)';

export function isExternalPath(path: string): boolean {
  return path.startsWith(PREFIX);
}

/**
 * 'lodash/get' -> 'lodash', '@scope/ui/button' -> '@scope/ui', 'fs' (built-in) -> 'node:fs', 'node:fs/promises' -> 'node:fs'.
 * Java imports group by package (at most three segments): 'org.springframework.boot.SpringApplication' -> 'org.springframework.boot',
 * 'static org.junit.Assert.assertEquals' -> 'org.junit', 'java.util.*' -> 'java.util'.
 */
export function packageOf(e: Edge): string | null {
  if (e.status !== 'external' || e.reason === 'URL import') return null;
  if (e.from.endsWith('.java')) {
    const pkg: string[] = [];
    for (const seg of e.specifier.replace(/^static\s+/, '').split('.')) {
      if (seg === '*' || /^[A-Z]/.test(seg) || pkg.length === 3) break;
      pkg.push(seg);
    }
    return pkg.join('.') || null;
  }
  let s = e.specifier.replace(/^(?:npm|jsr):/, '');
  if (e.reason === 'built-in module') return `node:${s.replace(/^node:/, '').split('/')[0]}`;
  if (s.startsWith('@')) s = s.split('/').slice(0, 2).join('/');
  else s = s.split('/')[0];
  return s.replace(/(?<=[^/])@[^@/]*$/, '') || null; // drop a version suffix ("chalk@5")
}

export function withExternalPackages(data: AtlasData): AtlasData {
  const packages = new Map<string, FileNode>();
  const edges: Edge[] = [];
  for (const e of data.edges) {
    const pkg = packageOf(e);
    if (!pkg) { edges.push(e); continue; }
    const path = `${PREFIX}${pkg}`;
    if (!packages.has(path)) {
      const i = path.lastIndexOf('/');
      packages.set(path, { path, name: path.slice(i + 1), ext: '', folder: path.slice(0, i), size: 0, lines: 0, kind: 'other', functions: [], exports: [] });
    }
    edges.push({ ...e, to: path, status: 'resolved', reason: EXTERNAL_REASON });
  }
  if (!packages.size) return data;
  return { ...data, files: [...data.files, ...[...packages.values()].sort((a, b) => (a.path < b.path ? -1 : 1))], edges };
}
