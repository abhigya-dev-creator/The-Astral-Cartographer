import fs from 'fs';
import path from 'path';
import { parseJsTs } from '../services/analysis/jsParser.js';
import { buildResolveContext, resolveJsImport } from '../services/analysis/resolver.js';

const CODE = /\.(?:[cm]?[jt]sx?)$/;

function walk(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out.sort();
}

/**
 * Resolve every import found in `dir` and return a stable, JSON-serialisable list.
 * `readText` (optional) is passed to the resolver to read config files instead of the disk.
 */
export function snapshotResolutions(dir: string, readText?: (rel: string) => string | null): unknown[] {
  const files = walk(dir);
  const ctx = buildResolveContext(dir, new Set(files), new Set(), readText);
  const out: unknown[] = [];
  for (const f of files) {
    if (!CODE.test(f) || f.endsWith('.d.ts')) continue;
    const parsed = parseJsTs(fs.readFileSync(path.join(dir, f), 'utf-8'), path.extname(f));
    for (const imp of parsed.imports) out.push({ importer: f, specifier: imp.specifier, resolution: resolveJsImport(ctx, f, imp.specifier) });
  }
  return out;
}

/** In-memory reader over the same folder, used to prove the `readText` path gives identical results. */
export function memoryReader(dir: string): (rel: string) => string | null {
  const texts = new Map(walk(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf-8')]));
  return (rel) => texts.get(rel) ?? null;
}
