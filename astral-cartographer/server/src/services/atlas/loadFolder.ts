import fs from 'fs';
import path from 'path';
import { ATLAS_LIMITS, IGNORED_DIRS, type SourceFile } from './analyzeAtlas.js';
import type { SkippedEntry } from './types.js';
import type { ExcludeMatcher } from '../excludePatterns.js';

/** Known binary formats: only their size is needed, so they are never read. */
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp3|mp4|m4a|webm|wav|ogg|flac|mov|avi|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|wasm|exe|dll|so|dylib|class|psd|sqlite|db)$/i;

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export interface LoadFolderOptions {
  /** texts already in memory (e.g. kept by CodeAnalyzer); files not in the map are read from disk */
  texts?: ReadonlyMap<string, string> | null;
  /** user-defined exclusions (Settings): matching files and folders are listed as skipped and never read */
  exclude?: ExcludeMatcher | null;
}

/**
 * Read a local folder into analyzer input. Ignored directories are recorded once and never read;
 * files over the size limit are listed with their size but their content is not loaded.
 * `diskReads` counts text files that had to be read from disk (not supplied in `texts`).
 */
export function loadFolder(root: string, opts: LoadFolderOptions = {}): { files: SourceFile[]; skipped: SkippedEntry[]; diskReads: number } {
  const files: SourceFile[] = [];
  const skipped: SkippedEntry[] = [];
  let diskReads = 0;
  const walk = (rel: string) => {
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (opts.exclude?.(r, e.isDirectory())) { skipped.push({ path: r, reason: 'excluded by settings' }); continue; }
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) skipped.push({ path: r, reason: 'ignored directory' });
        else walk(r);
      } else if (e.isFile()) {
        const full = path.join(root, r);
        const size = fs.statSync(full).size;
        const known = opts.texts?.get(r);
        if (known !== undefined) { files.push({ path: r, text: known, size }); continue; }
        if (size > ATLAS_LIMITS.MAX_FILE_BYTES || BINARY_EXT.test(e.name)) { files.push({ path: r, text: null, size }); continue; }
        const buf = fs.readFileSync(full);
        diskReads++;
        files.push({ path: r, text: isBinary(buf) ? null : buf.toString('utf8'), size });
      }
    }
  };
  walk('');
  return { files, skipped, diskReads };
}
