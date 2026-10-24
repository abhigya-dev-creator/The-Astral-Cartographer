import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { AtlasData } from './types.js';

/** What the analysis document keeps; the AtlasData itself lives in blob storage (GridFS later). */
export interface AtlasMeta {
  key: string;
  /** uncompressed JSON bytes */
  bytes: number;
  /** stored (gzip) bytes */
  storedBytes: number;
  files: number;
  edges: number;
  unresolved: number;
  parseErrors: number;
  cycles: number;
  savedAt: string;
  /** where file texts came from when the map was built inside the analysis pipeline */
  sourcesFrom?: 'memory' | 'memory+disk' | 'disk';
  /** text files that had to be read from disk while building the map */
  diskReads?: number;
  /** time spent building and storing the map, ms */
  buildMs?: number;
}

/** Persistence boundary: the analyzer never knows where results are stored. */
export interface AnalysisStore {
  save(key: string, data: AtlasData): Promise<AtlasMeta>;
  load(key: string): Promise<AtlasData | null>;
  remove(key: string): Promise<void>;
}

export function encodeAtlas(data: AtlasData): { gz: Buffer; bytes: number } {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  return { gz: zlib.gzipSync(json, { level: 6 }), bytes: json.length };
}

export function decodeAtlas(gz: Buffer): AtlasData {
  const data = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  const version = data?.version ?? 1;
  if (!data || (version !== 1 && version !== '1.0' && version !== '1') || !Array.isArray(data.files) || !Array.isArray(data.edges)) {
    throw new Error('Stored atlas data has an unsupported format.');
  }
  data.version = 1;
  return data as AtlasData;
}

function metaFor(key: string, data: AtlasData, bytes: number, storedBytes: number): AtlasMeta {
  return {
    key, bytes, storedBytes,
    files: data.stats.files, edges: data.stats.edges, unresolved: data.stats.unresolved,
    parseErrors: data.stats.parseErrors, cycles: data.cycles.length, savedAt: new Date().toISOString(),
  };
}

/** Keeps compressed blobs in memory (tests, local development). */
export class MemoryAtlasStore implements AnalysisStore {
  private blobs = new Map<string, Buffer>();
  async save(key: string, data: AtlasData) {
    const { gz, bytes } = encodeAtlas(data);
    this.blobs.set(key, gz);
    return metaFor(key, data, bytes, gz.length);
  }
  async load(key: string) {
    const gz = this.blobs.get(key);
    return gz ? decodeAtlas(gz) : null;
  }
  async remove(key: string) {
    this.blobs.delete(key);
  }
}

/** Writes `<dir>/<key>.json.gz` (sample data, offline use). */
export class JsonFileAtlasStore implements AnalysisStore {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(key)) throw new Error('Invalid atlas key.');
    return path.join(this.dir, `${key}.json.gz`);
  }
  async save(key: string, data: AtlasData) {
    const { gz, bytes } = encodeAtlas(data);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(key), gz);
    return metaFor(key, data, bytes, gz.length);
  }
  async load(key: string) {
    const f = this.file(key);
    return fs.existsSync(f) ? decodeAtlas(fs.readFileSync(f)) : null;
  }
  async remove(key: string) {
    fs.rmSync(this.file(key), { force: true });
  }
}
