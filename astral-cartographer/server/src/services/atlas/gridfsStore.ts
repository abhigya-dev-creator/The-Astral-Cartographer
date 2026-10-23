import mongoose from 'mongoose';
import type { Readable } from 'stream';
import { decodeAtlas, encodeAtlas, type AnalysisStore, type AtlasMeta } from './store.js';
import type { AtlasData } from './types.js';

/**
 * AtlasData in MongoDB GridFS (bucket "atlas"), stored as gzip-compressed JSON, so a large repository never
 * hits the 16 MB document limit. The file name is the key (the analysis id); metadata repeats the sizes.
 */
export const ATLAS_BUCKET = 'atlas';

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database is not connected.');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: ATLAS_BUCKET });
}

export class GridFsAtlasStore implements AnalysisStore {
  async save(key: string, data: AtlasData): Promise<AtlasMeta> {
    const { gz, bytes } = encodeAtlas(data);
    await this.remove(key); // re-saving replaces
    await new Promise<void>((resolve, reject) => {
      const up = bucket().openUploadStream(key, { metadata: { bytes, storedBytes: gz.length, contentEncoding: 'gzip' } });
      up.once('error', reject);
      up.once('finish', () => resolve());
      up.end(gz);
    });
    return {
      key, bytes, storedBytes: gz.length, files: data.stats.files, edges: data.stats.edges, unresolved: data.stats.unresolved,
      parseErrors: data.stats.parseErrors, cycles: data.cycles.length, savedAt: new Date().toISOString(),
    };
  }

  async load(key: string): Promise<AtlasData | null> {
    if (!(await this.exists(key))) return null;
    const chunks: Buffer[] = [];
    for await (const c of bucket().openDownloadStreamByName(key)) chunks.push(c as Buffer);
    return decodeAtlas(Buffer.concat(chunks));
  }

  async remove(key: string): Promise<void> {
    const b = bucket();
    for (const f of await b.find({ filename: key }).toArray()) await b.delete(f._id).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    return (await bucket().find({ filename: key }).limit(1).toArray()).length > 0;
  }

  /** Raw gzip stream for HTTP responses (the bytes are sent as-is with Content-Encoding: gzip). */
  openGzipStream(key: string): Readable {
    return bucket().openDownloadStreamByName(key);
  }

  /** Every stored key (for orphan cleanup). */
  async keys(): Promise<string[]> {
    return (await bucket().find({}, { projection: { filename: 1 } }).toArray()).map((f) => f.filename);
  }
}

export const atlasStore = new GridFsAtlasStore();
