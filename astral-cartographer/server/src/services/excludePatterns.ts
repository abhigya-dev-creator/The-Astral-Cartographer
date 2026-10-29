import { UserFacingError } from './safeArchive.js';

/**
 * User-defined exclusions for an analysis (Settings → "Excluded files and folders").
 * A simplified .gitignore syntax:
 *   - a pattern without "/" matches any file or folder with that name anywhere:   docs   *.test.ts   fixtures
 *   - a pattern with "/" is a path from the repository root; "**" spans folders:  src/legacy   examples/**   src/**\/*.gen.ts
 *   - "*" matches within one name, "?" matches one character; a trailing "/" means "folders only".
 * An excluded folder excludes everything inside it.
 */
export const EXCLUDE_LIMITS = { MAX_PATTERNS: 50, MAX_LENGTH: 200 };
const ALLOWED = /^[A-Za-z0-9._\-/*?@+ ]+$/;

export type ExcludeMatcher = (rel: string, isDir: boolean) => boolean;

/** Validated, de-duplicated and sorted patterns (sorted so equal sets compare equal). Throws a readable error. */
export function normalizeExcludePatterns(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { throw new UserFacingError('Excluded patterns must be a list of strings.'); }
  }
  if (!Array.isArray(list)) throw new UserFacingError('Excluded patterns must be a list of strings.');
  if (list.length > EXCLUDE_LIMITS.MAX_PATTERNS) throw new UserFacingError(`At most ${EXCLUDE_LIMITS.MAX_PATTERNS} excluded patterns are allowed.`);
  const out = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') throw new UserFacingError('Excluded patterns must be strings.');
    const p = item.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
    if (!p) continue;
    if (p.length > EXCLUDE_LIMITS.MAX_LENGTH) throw new UserFacingError(`Excluded pattern is too long (max ${EXCLUDE_LIMITS.MAX_LENGTH} characters).`);
    if (!ALLOWED.test(p) || p.startsWith('/') || p.split('/').some((s) => s === '..')) {
      throw new UserFacingError(`Excluded pattern "${p.slice(0, 60)}" is not allowed. Use names or paths inside the repository, with * and ? as wildcards.`);
    }
    out.add(p);
  }
  return [...out].sort();
}

/** A glob ("src/**\/*.gen.ts") as a regular expression body: "**\/" any folders, "/**" anything below, "*" within a name. */
function globRe(glob: string): string {
  return glob
    .replace(/[.+^${}()|[\]\\@]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\/\*\*$/, '\u0002')
    .replace(/\*\*/g, '\u0003')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '(?:/.*)?')
    .replace(/\u0003/g, '.*');
}

/** A matcher for repository-relative paths ("src/a/b.ts"), or null when there is nothing to exclude. */
export function compileExcludes(patterns: string[]): ExcludeMatcher | null {
  if (!patterns.length) return null;
  const rules = patterns.map((p) => {
    const dirOnly = p.endsWith('/');
    const body = dirOnly ? p.slice(0, -1) : p;
    // no "/": match the file or folder name anywhere; with "/": match the path from the root, and everything inside it
    return body.includes('/')
      ? { dirOnly, name: false, re: new RegExp(`^${globRe(body)}(?:/.*)?$`) }
      : { dirOnly, name: true, re: new RegExp(`^${globRe(body)}$`) };
  });
  return (rel, isDir) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.name ? r.re.test(name) : r.re.test(rel)) return true;
    }
    return false;
  };
}
