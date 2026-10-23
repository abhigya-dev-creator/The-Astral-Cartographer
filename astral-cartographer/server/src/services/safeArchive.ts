import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { IGNORED_DIR_NAMES } from './analysis/languages.js';

/** An error whose message is safe to show to the end user. */
export class UserFacingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UserFacingError';
    this.status = status;
  }
}

export const ARCHIVE_LIMITS = {
  MAX_ENTRIES: 20_000,
  MAX_FILE_BYTES: 50 * 1024 * 1024,
  MAX_TOTAL_BYTES: 200 * 1024 * 1024,
  MAX_RATIO: 200, // compressed -> uncompressed, per entry above 1 MB
  MAX_PATH_LENGTH: 400,
  MAX_DEPTH: 40,
};

export interface ExtractStats {
  entries: number;
  extractedFiles: number;
  extractedBytes: number;
  skippedSymlinks: number;
  skippedIgnored: number;
  skippedOversize: number;
}

export function isZipBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7);
}

/**
 * Extract a zip into `destDir` without trusting anything in it:
 *  - entry names are validated (no traversal, absolute paths, drive letters, NULs, backslash tricks)
 *  - symlinks and special files are never created
 *  - sizes are measured from the decompressed bytes, not from the (forgeable) header
 *  - directories that are ignored by the analyzer (node_modules, .git…) are not written to disk
 *  - file modes are never preserved (nothing becomes executable)
 * Nothing in the archive is ever executed.
 */
export function safeExtract(zip: AdmZip, destDir: string): { root: string; stats: ExtractStats; commitComment: string } {
  const entries = zip.getEntries();
  const stats: ExtractStats = { entries: entries.length, extractedFiles: 0, extractedBytes: 0, skippedSymlinks: 0, skippedIgnored: 0, skippedOversize: 0 };

  if (entries.length === 0) throw new UserFacingError('The archive contains no files.');
  if (entries.length > ARCHIVE_LIMITS.MAX_ENTRIES) {
    throw new UserFacingError(`Archive has too many entries (${entries.length}; maximum ${ARCHIVE_LIMITS.MAX_ENTRIES}).`);
  }

  const destRoot = path.resolve(destDir);
  fs.mkdirSync(destRoot, { recursive: true });

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const name = entry.entryName.replace(/\\/g, '/');
    if (name.includes('\0') || name.length > ARCHIVE_LIMITS.MAX_PATH_LENGTH || /^[a-zA-Z]:/.test(name) || name.startsWith('/')) {
      throw new UserFacingError('Malicious or invalid archive entry detected (unsafe path).');
    }
    const segments = name.split('/').filter((s) => s !== '' && s !== '.');
    if (segments.some((s) => s === '..') || segments.length > ARCHIVE_LIMITS.MAX_DEPTH) {
      throw new UserFacingError('Malicious archive entry detected (path traversal attempt).');
    }
    if (segments.length === 0) continue;

    // symlink / special file: unix mode lives in the high 16 bits of the external attributes
    const mode = (entry.header.attr >>> 16) & 0o170000;
    if (mode === 0o120000) { stats.skippedSymlinks++; continue; }
    if (mode !== 0 && mode !== 0o100000) continue; // devices, fifos, sockets

    // Don't write third-party / VCS / build directories (they are excluded from analysis anyway)
    if (segments.slice(0, -1).some((s) => IGNORED_DIR_NAMES.has(s)) || segments[0] === '__MACOSX') {
      stats.skippedIgnored++;
      continue;
    }

    const declared = entry.header.size;
    if (declared > ARCHIVE_LIMITS.MAX_FILE_BYTES) { stats.skippedOversize++; continue; }
    if (declared > 1024 * 1024 && entry.header.compressedSize > 0 && declared / entry.header.compressedSize > ARCHIVE_LIMITS.MAX_RATIO) {
      throw new UserFacingError('Archive rejected: suspicious compression ratio (possible zip bomb).');
    }

    const target = path.resolve(destRoot, ...segments);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      throw new UserFacingError('Malicious archive entry detected (path traversal attempt).');
    }

    let data: Buffer;
    try {
      data = entry.getData();
    } catch {
      throw new UserFacingError('Archive is corrupted or uses an unsupported compression/encryption method.');
    }
    // trust measured bytes, not the header
    if (data.length > ARCHIVE_LIMITS.MAX_FILE_BYTES) { stats.skippedOversize++; continue; }
    stats.extractedBytes += data.length;
    if (stats.extractedBytes > ARCHIVE_LIMITS.MAX_TOTAL_BYTES) {
      throw new UserFacingError(`Archive uncompressed content exceeds the size limit (${ARCHIVE_LIMITS.MAX_TOTAL_BYTES / 1024 / 1024} MB).`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { mode: 0o644 });
    stats.extractedFiles++;
  }

  // GitHub archives wrap everything in a single "<repo>-<ref>/" directory
  const top = fs.readdirSync(destRoot, { withFileTypes: true });
  const root = top.length === 1 && top[0].isDirectory() ? path.join(destRoot, top[0].name) : destRoot;

  let commitComment = '';
  try { commitComment = (zip.getZipComment() || '').trim(); } catch { /* none */ }
  return { root, stats, commitComment };
}
