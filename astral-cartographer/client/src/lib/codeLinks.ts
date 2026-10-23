/**
 * Where to send the user to read a file. The Code Explorer page is not built yet; until it is, files open in the
 * Dependency Atlas, which selects the file, shows its connections and its source (Code tab). When the Code Explorer
 * exists, set CODE_EXPLORER_READY and give it the same query parameters, and every caller switches over.
 */
export const CODE_EXPLORER_READY = false;

export interface CodeLinkRepo {
  _id: string;
  owner: string;
  name: string;
  source: 'github' | 'zip';
}

/** In-app link that opens `path` (optionally at `line`) of the repository. */
export function codeViewLink(repo: CodeLinkRepo, path: string, line?: number): { to: string; label: string } {
  const q = new URLSearchParams({ repo: repo._id, file: path });
  if (line) q.set('line', String(line));
  return CODE_EXPLORER_READY
    ? { to: `/explorer?${q}`, label: 'Open in Code Explorer' }
    : { to: `/atlas?${q}`, label: 'Open in Dependency Atlas' };
}

const SHA_RE = /^[0-9a-f]{40}$/i;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** GitHub page of the file at the analysed commit, or null (ZIP uploads, missing or invalid commit, invalid names). */
export function githubFileUrl(repo: CodeLinkRepo, commitSha: string | null | undefined, path: string, line?: number): string | null {
  if (repo.source !== 'github' || !commitSha || !SHA_RE.test(commitSha) || !OWNER_RE.test(repo.owner) || !REPO_RE.test(repo.name)) return null;
  const segments = path.split('/');
  if (!path || segments.some((s) => !s || s === '.' || s === '..')) return null;
  return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/blob/${commitSha.toLowerCase()}/${segments.map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
}
