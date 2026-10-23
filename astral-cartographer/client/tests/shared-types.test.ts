import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAtlasData, type AtlasData as ClientAtlasData } from '../src/features/atlas/model';
import { validateAtlasData } from '../../server/src/services/atlas/validate';
import type { AtlasData as ServerAtlasData } from '../../server/src/services/atlas/types';

// Compile-time: the client type must be exactly the server type (this file fails `tsc -p tests` if they drift).
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const sameType: Equal<ClientAtlasData, ServerAtlasData> = true;

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(fs.readFileSync(path.join(here, '../src/features/atlas/sample/atlas-sample.json'), 'utf8'));

test('the same sample JSON is valid for both the client parser and the server validator', () => {
  assert.equal(sameType, true);
  assert.deepEqual(validateAtlasData(sample), [], 'server validator');
  const parsed: ServerAtlasData = parseAtlasData(sample); // client parser result is assignable to the server type
  assert.equal(parsed.files.length, sample.files.length);
});

test('both validators reject the same broken data', () => {
  const broken = JSON.parse(JSON.stringify(sample));
  broken.edges[0] = { ...broken.edges[0], status: 'resolved', to: 'does/not/exist.ts' };
  assert.ok(validateAtlasData(broken).some((e) => /resolved edge must point at a file/.test(e)));
  assert.throws(() => parseAtlasData(broken), /invalid target/);
  assert.ok(validateAtlasData({ ...sample, version: 2 }).length > 0);
  assert.throws(() => parseAtlasData({ ...sample, version: 2 }), /unsupported version/);
});
