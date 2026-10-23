import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { safeExtract, isZipBuffer, UserFacingError, ARCHIVE_LIMITS } from '../services/safeArchive.js';
import { parseGitHubUrl } from '../services/github.js';
import { fitToDocumentLimit } from '../services/repositoryService.js';
import { rawZip, type RawEntry } from './helpers.js';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'astral-sec-')); dirs.push(d); return d; };
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** Raw bytes exactly as an attacker could craft them (see helpers.rawZip). */
const zipOf = (entries: RawEntry[]): AdmZip => new AdmZip(rawZip(entries));
const rejects = (z: AdmZip, re: RegExp) => {
  const dest = tmp();
  assert.throws(() => safeExtract(z, dest), (e: any) => e instanceof UserFacingError && re.test(e.message));
  return dest;
};

test('archive: path traversal entries are rejected and nothing escapes the destination', () => {
  const parent = tmp();
  const dest = path.join(parent, 'dest');
  for (const name of ['../evil.txt', 'a/../../evil.txt', '..\\evil.txt', 'a\\..\\..\\evil.txt']) {
    assert.throws(() => safeExtract(zipOf([{ name }]), dest), UserFacingError, name);
  }
  assert.equal(fs.existsSync(path.join(parent, 'evil.txt')), false);
});

test('archive: absolute paths, drive letters and NUL bytes are rejected', () => {
  for (const name of ['/etc/cron.d/x', 'C:/Windows/x', 'C:\\x', 'a\0b.txt']) rejects(zipOf([{ name }]), /unsafe path|invalid/i);
});

test('archive: symlinks are never created; permissions are not preserved', () => {
  const dest = tmp();
  const z = zipOf([
    { name: 'repo/link', data: '/etc/passwd', mode: 0o120777 },
    { name: 'repo/run.sh', data: '#!/bin/sh\necho hi', mode: 0o100755 },
    { name: 'repo/ok.js', data: 'export const a = 1;' },
  ]);
  const { root, stats } = safeExtract(z, dest);
  assert.equal(stats.skippedSymlinks, 1);
  assert.equal(fs.existsSync(path.join(root, 'link')), false);
  assert.equal(fs.statSync(path.join(root, 'run.sh')).mode & 0o111, 0, 'no executable bits');
  assert.equal(path.basename(root), 'repo', 'single top-level directory is unwrapped');
});

test('archive: node_modules/.git contents are not written to disk', () => {
  const dest = tmp();
  const { root, stats } = safeExtract(zipOf([{ name: 'r/node_modules/x/i.js' }, { name: 'r/.git/config' }, { name: 'r/src/a.js' }]), dest);
  assert.equal(stats.skippedIgnored, 2);
  assert.equal(stats.extractedFiles, 1);
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
});

test('archive: zip bombs (huge compression ratio) and oversized totals are rejected', () => {
  const bomb = new AdmZip(); bomb.addFile('bomb.txt', Buffer.alloc(8 * 1024 * 1024));
  rejects(new AdmZip(bomb.toBuffer()), /compression ratio/i);
  const saved = ARCHIVE_LIMITS.MAX_TOTAL_BYTES;
  ARCHIVE_LIMITS.MAX_TOTAL_BYTES = 100;
  try { rejects(zipOf([{ name: 'a.txt', data: 'x'.repeat(80) }, { name: 'b.txt', data: 'y'.repeat(80) }]), /size limit/i); }
  finally { ARCHIVE_LIMITS.MAX_TOTAL_BYTES = saved; }
});

test('archive: ZIP magic number check', () => {
  assert.equal(isZipBuffer(new AdmZip().toBuffer()), true);
  assert.equal(isZipBuffer(Buffer.from('<html>not a zip</html>')), false);
  assert.equal(isZipBuffer(Buffer.alloc(0)), false);
});

test('GitHub URL parsing accepts real forms and rejects look-alike hosts', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/expressjs/express'), { owner: 'expressjs', repo: 'express', ref: undefined });
  assert.deepEqual(parseGitHubUrl('github.com/a/b.git'), { owner: 'a', repo: 'b', ref: undefined });
  assert.deepEqual(parseGitHubUrl('https://www.github.com/a/b/'), { owner: 'a', repo: 'b', ref: undefined });
  assert.deepEqual(parseGitHubUrl('git@github.com:a/b.git'), { owner: 'a', repo: 'b', ref: undefined });
  assert.equal(parseGitHubUrl('https://github.com/a/b/tree/dev/src')?.ref, 'dev');
  assert.equal(parseGitHubUrl('https://github.com/a/b.js?tab=readme')?.repo, 'b.js');
  for (const bad of [
    'https://evil.com/github.com/a/b', 'https://github.com.evil.com/a/b', 'https://notgithub.com/a/b', 'https://github.com/a',
    'https://github.com/a/..', 'https://github.com/-bad-/x', 'https://github.com/a/b c', 'ftp://github.com/a/b', '', 'x'.repeat(400),
  ]) assert.equal(parseGitHubUrl(bad), null, bad);
});

test('stored analysis is reduced (and says so) when it would exceed the document limit', () => {
  const mk = () => ({
    files: Array.from({ length: 200 }, (_, i) => ({
      path: `f${i}.js`, parseStatus: i % 2 ? 'parsed' : 'not_code', dependencies: Array(50).fill('some-long-package-name'), warnings: ['w'], unresolvedLocalDeps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })),
  });
  // fits already -> untouched
  const untouched = mk(); const w0: string[] = [];
  assert.equal(fitToDocumentLimit(untouched, w0, 10_000_000), false);
  assert.equal(untouched.files[0].dependencies.length, 50);
  assert.deepEqual(w0, []);
  // too big, but dropping raw import lists is enough -> reduced + warning, files kept
  const reduced = mk(); const w1: string[] = [];
  assert.equal(fitToDocumentLimit(reduced, w1, 60_000), true);
  assert.equal(reduced.files.length, 200);
  assert.equal(reduced.files[0].dependencies.length, 0);
  assert.match(w1.join(' '), /reduced to fit the database limit/);
  // impossible -> explicit error, never a silent failure at save time
  assert.throws(() => fitToDocumentLimit(mk(), [], 100), (e: any) => e instanceof UserFacingError && e.status === 413);
});
