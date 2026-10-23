/**
 * Run the Atlas analyzer on a local folder and write AtlasData JSON.
 *
 *   npx tsx src/scripts/atlas-sample.ts <folder> <out.json> [--owner o] [--name n] [--branch b] [--sha <commit>] [--source github|zip]
 *
 * Only paths, sizes and measured metadata are written; no source code.
 */
import fs from 'fs';
import path from 'path';
import { analyzeAtlas } from '../services/atlas/analyzeAtlas.js';
import { loadFolder } from '../services/atlas/loadFolder.js';
import { encodeAtlas } from '../services/atlas/store.js';

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const [folder, out] = positional;
if (!folder || !out) {
  console.error('Usage: atlas-sample <folder> <out.json> [--owner o] [--name n] [--branch b] [--sha commit] [--source github|zip]');
  process.exit(2);
}

const t0 = performance.now();
const { files, skipped } = loadFolder(path.resolve(folder));
const t1 = performance.now();
const source = opt('source', 'github') === 'zip' ? 'zip' : 'github';
const atlas = analyzeAtlas({
  repo: {
    owner: opt('owner', 'local'),
    name: opt('name', path.basename(path.resolve(folder))),
    branch: opt('branch', 'main'),
    commitSha: opt('sha', ''),
    source,
  },
  files,
  skipped,
});
const t2 = performance.now();
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(atlas, null, 1) + '\n');
const { gz, bytes } = encodeAtlas(atlas);
console.log(
  `files=${atlas.stats.files} edges=${atlas.stats.edges} unresolved=${atlas.stats.unresolved} parseErrors=${atlas.stats.parseErrors} ` +
    `cycles=${atlas.cycles.length} skipped=${atlas.stats.skipped.length} | read ${(t1 - t0).toFixed(0)} ms, analyse ${(t2 - t1).toFixed(0)} ms | ` +
    `json ${(bytes / 1024).toFixed(1)} KB, gzip ${(gz.length / 1024).toFixed(1)} KB -> ${out}`
);
