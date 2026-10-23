/**
 * Benchmark the Atlas analyzer on synthetic repositories (deterministic, seeded).
 *
 *   npx tsx src/scripts/atlas-bench.ts [sizes...]        default: 500 2000 10000
 *
 * Reports the median of 3 runs: analysis time, AtlasData JSON size and gzip size.
 */
import zlib from 'zlib';
import { analyzeAtlas, type SourceFile } from '../services/atlas/analyzeAtlas.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOP = ['app', 'components', 'hooks', 'lib', 'pages', 'utils', 'assets', 'config', 'types', 'services', 'store', 'features'];
const PKGS = ['react', 'react-dom', 'lodash', 'zod', 'date-fns', '@tanstack/react-query', 'axios', 'clsx'];

export function syntheticRepo(n: number, seed = 42): SourceFile[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const depth = Math.floor(rnd() * 3);
    let dir = `src/${pick(TOP)}`;
    for (let d = 0; d < depth; d++) dir += `/sub${Math.floor(rnd() * 6)}`;
    paths.push(`${dir}/mod${i}.${rnd() < 0.6 ? 'ts' : 'tsx'}`);
  }
  const files: SourceFile[] = [{ path: 'tsconfig.json', text: '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }' }];
  for (let i = 0; i < n; i++) {
    const me = paths[i];
    const meDir = me.slice(0, me.lastIndexOf('/'));
    const lines: string[] = [];
    const imports = 2 + Math.floor(rnd() * 6);
    for (let k = 0; k < imports; k++) {
      const r = rnd();
      const target = paths[Math.floor(rnd() * n)].replace(/\.tsx?$/, '');
      if (r < 0.45) {
        const rel = relative(meDir, target);
        lines.push(`import { x${k} } from '${rel}';`);
      } else if (r < 0.7) lines.push(`import { y${k} } from '@/${target.slice(4)}';`);
      else if (r < 0.95) lines.push(`import z${k} from '${pick(PKGS)}';`);
      else lines.push(`import missing${k} from './does-not-exist-${k}';`);
    }
    const fns = 1 + Math.floor(rnd() * 5);
    for (let f = 0; f < fns; f++) {
      lines.push(`export function fn${i}_${f}(a: number, b?: string): number {`);
      lines.push(`  if (a > ${f} && b) { for (const c of b) { if (c === 'x') return a; } }`);
      lines.push(`  return a > 1 ? a * 2 : b?.length ?? 0;`);
      lines.push('}');
    }
    if (rnd() < 0.3) lines.push(`export class Service${i} { run(v: number) { try { return v || 1; } catch { return 0; } } }`);
    if (me.endsWith('.tsx')) lines.push(`export const View${i} = () => <div className="v">{fn${i}_0(1)}</div>;`);
    files.push({ path: me, text: lines.join('\n') + '\n' });
  }
  return files;
}

function relative(fromDir: string, target: string): string {
  const a = fromDir.split('/');
  const b = target.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  return (up === 0 ? './' : '../'.repeat(up)) + b.slice(i).join('/');
}

if (process.argv[1]?.includes('atlas-bench')) {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  for (const n of sizes.length ? sizes : [500, 2000, 10000]) {
    const files = syntheticRepo(n);
    const srcBytes = files.reduce((s, f) => s + (f.text?.length ?? 0), 0);
    const times: number[] = [];
    let atlas!: ReturnType<typeof analyzeAtlas>;
    for (let r = 0; r < 3; r++) {
      const t = performance.now();
      atlas = analyzeAtlas({ repo: { owner: 'bench', name: `synthetic-${n}`, branch: 'main', commitSha: '', analyzedAt: 'T' }, files });
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    const json = Buffer.from(JSON.stringify(atlas));
    const gz = zlib.gzipSync(json, { level: 6 });
    console.log(
      `${String(n).padStart(6)} files | source ${(srcBytes / 1048576).toFixed(1)} MB | analyse median ${times[1].toFixed(0)} ms ` +
        `(min ${times[0].toFixed(0)}, max ${times[2].toFixed(0)}) | edges ${atlas.stats.edges} | unresolved ${atlas.stats.unresolved} | ` +
        `cycles ${atlas.cycles.length} | AtlasData JSON ${(json.length / 1048576).toFixed(2)} MB | gzip ${(gz.length / 1048576).toFixed(2)} MB`
    );
  }
}
