import type { AtlasData } from './types.js';

/**
 * Runtime check of an AtlasData value against the shapes in types.ts. Returns a list of problems (empty = valid).
 * Pure (no Node APIs), so the client test suite can run it against the same sample JSON as the client parser.
 */
export function validateAtlasData(raw: unknown): string[] {
  const errs: string[] = [];
  const d = raw as Partial<AtlasData> | null;
  const isStr = (v: unknown) => typeof v === 'string';
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!d || typeof d !== 'object') return ['not an object'];
  const rawVersion = d.version !== undefined && d.version !== null && (d.version as any) !== '' ? d.version : '1.0';
  if (rawVersion !== 1 && rawVersion !== '1.0' && rawVersion !== '1') errs.push(`version must be 1, got ${String(d.version)}`);
  const r = d.repo;
  if (!r || !['owner', 'name', 'branch', 'commitSha', 'analyzedAt'].every((k) => isStr((r as any)[k]))) errs.push('repo: owner, name, branch, commitSha and analyzedAt must be strings');
  if (r?.source !== undefined && r.source !== 'github' && r.source !== 'zip') errs.push('repo.source must be github or zip');

  const paths = new Set<string>();
  if (!Array.isArray(d.files)) errs.push('files must be an array');
  else d.files.forEach((f, i) => {
    const at = `files[${i}]`;
    if (!isStr(f?.path) || !isStr(f.name) || !isStr(f.ext) || !isStr(f.folder)) errs.push(`${at}: path, name, ext, folder must be strings`);
    if (!isNum(f?.size) || !isNum(f?.lines)) errs.push(`${at}: size and lines must be numbers`);
    if (!['code', 'asset', 'other'].includes(f?.kind as string)) errs.push(`${at}: kind must be code, asset or other`);
    if (!Array.isArray(f?.functions) || f.functions.some((fn) => !isStr(fn?.name) || !isNum(fn?.line) || !['function', 'class', 'method'].includes(fn?.kind))) errs.push(`${at}: functions malformed`);
    if (!Array.isArray(f?.exports) || f.exports.some((x) => !isStr(x))) errs.push(`${at}: exports must be strings`);
    for (const k of ['complexity', 'tokens'] as const) if (f?.[k] !== undefined && !isNum(f[k])) errs.push(`${at}: ${k} must be a number when present`);
    if (f?.parseError !== undefined && !isStr(f.parseError)) errs.push(`${at}: parseError must be a string when present`);
    if (isStr(f?.path)) paths.add(f.path);
  });

  if (!Array.isArray(d.edges)) errs.push('edges must be an array');
  else d.edges.forEach((e, i) => {
    const at = `edges[${i}]`;
    if (!isStr(e?.from) || !paths.has(e.from)) errs.push(`${at}: from must be a file path`);
    if (!isStr(e?.specifier) || !isNum(e?.line)) errs.push(`${at}: specifier/line malformed`);
    if (!['import', 'reexport', 'require', 'dynamic'].includes(e?.kind as string)) errs.push(`${at}: bad kind`);
    if (e?.status === 'resolved') { if (!isStr(e.to) || !paths.has(e.to as string)) errs.push(`${at}: resolved edge must point at a file`); }
    else if (e?.status === 'external' || e?.status === 'unresolved') { if (e.to !== null) errs.push(`${at}: ${e.status} edge must have to = null`); }
    else errs.push(`${at}: bad status`);
  });

  if (!Array.isArray(d.cycles) || d.cycles.some((c) => !Array.isArray(c) || c.some((p) => !paths.has(p)))) errs.push('cycles must be lists of file paths');
  const s = d.stats;
  if (!s || !['files', 'edges', 'unresolved', 'parseErrors'].every((k) => isNum((s as any)[k])) || !Array.isArray(s.skipped)) errs.push('stats malformed');
  else if (Array.isArray(d.files) && Array.isArray(d.edges) && (s.files !== d.files.length || s.edges !== d.edges.length)) errs.push('stats.files/edges do not match the arrays');
  return errs;
}
