import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { CodeAnalyzer } from '../services/analyzer.js';
import { makeRepo, cleanupRepos } from './helpers.js';

after(cleanupRepos);
const analyze = (files: Record<string, string | Buffer>, opts = {}) => new CodeAnalyzer(makeRepo(files), opts).analyze();
const edges = (r: Awaited<ReturnType<typeof analyze>>, type = 'internal') =>
  r.dependencyGraph.filter((e) => e.type === type).map((e) => `${e.source}->${e.target}`);

test('TypeScript NodeNext: "./b.js" resolves to b.ts (not unresolved)', async () => {
  const r = await analyze({ 'src/a.ts': `import {b} from './b.js'; export const a = b;`, 'src/b.ts': `export const b = 1;` });
  assert.deepEqual(edges(r), ['src/a.ts->src/b.ts']);
  assert.equal(r.metrics.dependencyMetrics!.unresolvedLocalImports, 0);
});

test('JSX inside a plain .js file is parsed with the AST, not the regex fallback', async () => {
  const r = await analyze({ 'App.js': `import React from 'react';\nexport function App(){ const f = () => <div/>; return <div onClick={() => f()}/>; }\nconst g = () => 1;` });
  assert.equal(r.files[0].parseStatus, 'parsed');
  assert.equal(r.metrics.functions, 4); // App, f, onClick arrow, g
});

test('function counting definition: ctor, private + object methods counted; overloads and signatures are not', async () => {
  const r = await analyze({
    'a.ts': `class A { constructor(){} #p(){} get x(){return 1} static s(){} m(): void; m(a?: number): void {} abstract_(): void {} }
function ov(a: string): void; function ov(a: any): void {}
interface I { sig(): void }
declare function d(): void;
const o = { m(){}, f: function(){} };`,
  });
  assert.equal(r.metrics.functions, 9); // ctor, #p, get x, s, m(impl), abstract_, ov(impl), o.m, o.f  (overloads/signatures/declare excluded)
  const k = r.metrics.functionKinds!;
  assert.equal(k.constructors, 1);
  assert.equal(k.declarations, 1);
  assert.equal(k.objectMethods, 1);
  assert.equal(k.methods, 5);
  assert.equal(k.expressions, 1);
});

test('import kinds: type-only, import=require, template literal, non-literal dynamic', async () => {
  const r = await analyze({
    'a.ts': 'import type {T} from \'./t\'; import fs = require(\'fs\'); const m = await import(`./u`); const n = import(name);',
    't.ts': 'export type T = 1;',
    'u.ts': 'export const u = 1;',
  });
  const m = r.metrics.dependencyMetrics!;
  assert.equal(m.rawImportStatements, 3);
  assert.equal(m.dynamicNonLiteralImports, 1);
  assert.equal(m.builtInModules, 1);
  const kinds = Object.fromEntries(r.dependencyGraph.filter((e) => e.type === 'internal').map((e) => [e.target, e.kind]));
  assert.equal(kinds['t.ts'], 'type');
  assert.equal(kinds['u.ts'], 'dynamic');
});

test('tsconfig paths via extends + project references resolve; bare "@/x" without config is an alias, not a package', async () => {
  const r = await analyze({
    'tsconfig.base.json': `{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"], }, } }`,
    'app/tsconfig.json': `{ "extends": "../tsconfig.base.json" }`,
    'app/main.ts': `import {x} from '@lib/x'; import {y} from '@/y';`,
    'src/lib/x.ts': `export const x = 1;`,
  });
  assert.deepEqual(edges(r), ['app/main.ts->src/lib/x.ts']);
  assert.equal(r.metrics.dependencyMetrics!.externalPackages, 0);
  assert.equal(r.metrics.dependencyMetrics!.unresolvedAliasImports, 1);

  const v = await analyze({
    'tsconfig.json': `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }`,
    'tsconfig.app.json': `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
    'src/main.ts': `import {y} from '@/y';`,
    'src/y.ts': `export const y = 1;`,
  });
  assert.deepEqual(edges(v), ['src/main.ts->src/y.ts']);
});

test('monorepo workspaces: cross-package import (incl. build-dir entry) resolves to source', async () => {
  const r = await analyze({
    'package.json': `{ "name": "root", "workspaces": ["packages/*"] }`,
    'packages/core/package.json': `{ "name": "@acme/core", "main": "./distribution/index.js" }`,
    'packages/core/src/index.ts': `export const core = 1;`,
    'packages/core/src/util.ts': `export const util = 1;`,
    'packages/web/package.json': `{ "name": "@acme/web" }`,
    'packages/web/src/app.ts': `import {core} from '@acme/core'; import {util} from '@acme/core/util'; import _ from 'lodash';`,
  });
  assert.deepEqual(edges(r).sort(), ['packages/web/src/app.ts->packages/core/src/index.ts', 'packages/web/src/app.ts->packages/core/src/util.ts']);
  assert.deepEqual(edges(r, 'external'), ['packages/web/src/app.ts->lodash']);
  assert.equal(r.metrics.dependencyMetrics!.unresolvedLocalImports, 0);
});

test('built-ins are normalised once; a declared npm package named like a built-in is external', async () => {
  const r = await analyze({
    'a.js': `import a from 'fs/promises'; import b from 'node:fs/promises'; import c from 'node:test'; import e from 'events';`,
    'package.json': `{ "dependencies": { "events": "^3.0.0" } }`,
  });
  assert.deepEqual(edges(r, 'builtin').sort(), ['a.js->fs/promises', 'a.js->test']);
  assert.deepEqual(edges(r, 'external'), ['a.js->events']);
  assert.equal(r.metrics.dependencyMetrics!.builtInModules, 2);
});

test('asset imports exist => not unresolved; missing relative import => unresolved', async () => {
  const r = await analyze({ 'a.js': `import l from './logo.png'; import './nope.js';`, 'logo.png': Buffer.from([137, 80, 78, 71, 0]) });
  const m = r.metrics.dependencyMetrics!;
  assert.equal(m.assetImports, 1);
  assert.equal(m.unresolvedLocalImports, 1);
  assert.deepEqual(r.files.find((f) => f.path === 'a.js')!.unresolvedLocalDeps, ['./nope.js']);
});

test('discovery excludes minified, lock files, binaries and reports why', async () => {
  const r = await analyze({
    'x.js': 'export const y = 1;', 'lib.min.js': '!function(){var a=function(){}}();', 'pnpm-lock.yaml': 'v: 9',
    'data.xyz': Buffer.from([0, 1, 2, 0]), 'img.png': Buffer.from([1]), 'node_modules/p/i.js': 'x', '.hidden/h.js': 'x',
  });
  assert.equal(r.metrics.totalFiles, 1);
  const ex = r.metrics.coverage.excluded;
  assert.equal(ex.minified_or_sourcemap, 1);
  assert.equal(ex.lockfile, 1);
  assert.equal(ex.binary_content, 1); // unknown extension, detected by NUL bytes
  assert.equal(ex.asset_or_binary, 1); // known extension
  assert.ok(r.metrics.coverage.excludedDirectories.includes('node_modules'));
  assert.ok(r.metrics.coverage.excludedDirectories.includes('.hidden'));
});

test('circular dependencies: one finding per tangled group (not per path); self-import; type-only cycles are info', async () => {
  const r = await analyze({
    'a.js': `import './b.js'; import './c.js'`, 'b.js': `import './a.js'; import './c.js'`, 'c.js': `import './a.js'`,
    'd.js': `import './d.js'`,
    'e.ts': `import type {F} from './f'; export type E = 1;`, 'f.ts': `import type {E} from './e'; export type F = 1;`,
  });
  const cyc = r.issues.filter((i) => i.type === 'circular_dependency');
  assert.equal(cyc.length, 3);
  const group = cyc.find((c) => c.affectedFiles.includes('a.js'))!;
  assert.deepEqual([...group.affectedFiles].sort(), ['a.js', 'b.js', 'c.js']);
  assert.equal(group.severity, 'error');
  assert.equal(group.confidence, 'confirmed');
  assert.equal(group.line, 1);
  assert.equal(cyc.find((c) => c.file === 'd.js')!.severity, 'error');
  assert.equal(cyc.find((c) => c.file === 'e.ts')!.severity, 'info');
});

test('very deep import chain does not overflow the stack', async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 3000; i++) files[`m${i}.js`] = i < 2999 ? `import './m${i + 1}.js';` : `export const end = 1;`;
  files['m2999.js'] = `import './m0.js';`;
  const r = await analyze(files);
  const cyc = r.issues.filter((i) => i.type === 'circular_dependency');
  assert.equal(cyc.length, 1);
  assert.equal(cyc[0].affectedFiles.length, 50); // capped list; description carries the true size
  assert.match(cyc[0].description, /3000 mutually dependent files|-> /);
});

test('large file is reported (oversized + skipped_large + partial), never a silent zero', async () => {
  const r = await analyze({ 'big.js': 'export const x = 1;\n'.repeat(1000) }, { maxParseBytes: 1000 });
  assert.equal(r.files[0].parseStatus, 'skipped_large');
  assert.equal(r.files[0].lineCount, 1000);
  assert.equal(r.files[0].functionCount, null);
  assert.ok(r.issues.some((i) => i.type === 'oversized_file'));
  assert.equal(r.metrics.supportStatus.functionsStatus, 'partial');
  assert.equal(r.metrics.coverage.completeness, 'partial');
});

test('unparseable file is flagged as regex fallback and metrics become partial', async () => {
  const r = await analyze({ 'bad.js': `import x from 'x';\nconst f = (a) => a;\nfunction h( {{{ \n` });
  assert.equal(r.files[0].parseStatus, 'fallback');
  assert.ok(r.files[0].warnings.length > 0);
  assert.equal(r.metrics.supportStatus.functionsStatus, 'partial');
  assert.equal(r.metrics.dependencyMetrics!.externalPackages, 1);
});

test('unsupported / no-code repositories show N/A (null) – never zero', async () => {
  const rb = await analyze({ 'a.rb': 'def foo\nend\n', 'b.php': '<?php function f(){}' });
  assert.equal(rb.metrics.functions, null);
  assert.equal(rb.metrics.dependencies, null);
  assert.equal(rb.metrics.dependencyMetrics, null);
  assert.equal(rb.metrics.supportStatus.functionsStatus, 'unsupported');
  const docs = await analyze({ 'README.md': '# hi' });
  assert.equal(docs.metrics.functions, null);
  assert.equal(docs.primaryLanguage, 'Markdown');
  const empty = await analyze({});
  assert.equal(empty.primaryLanguage, 'Unknown');
});

test('language percentages add up to 100 and primary language prefers code over markup', async () => {
  const files: Record<string, string> = { 'main.py': 'def f():\n  pass\n' };
  for (let i = 0; i < 3; i++) files[`t${i}.html`] = '<p>x</p>';
  files['a.css'] = 'a{}'; files['b.css'] = 'a{}'; files['c.md'] = '# x';
  const r = await analyze(files);
  assert.equal(r.languages.reduce((s, l) => s + l.percentage, 0), 100);
  assert.equal(r.primaryLanguage, 'Python');
});

test('rule coverage is explicit: 0 findings still reports eligible files and what was skipped', async () => {
  const r = await analyze({ 'a.js': 'export const a = 1;', 'x.rb': 'puts 1', 'a.test.js': 'test()' });
  const rules = r.metrics.coverage.rules;
  assert.deepEqual(rules.map((x) => x.type), ['circular_dependency', 'high_coupling', 'oversized_file', 'deep_import_nesting']);
  assert.ok(rules.every((x) => x.eligibleFiles >= 1));
  assert.ok(Object.keys(rules[0].skipped).some((k) => k.startsWith('Ruby')));
  assert.equal(rules.find((x) => x.type === 'oversized_file')!.skipped['test file'], 1);
  assert.equal(r.issues.length, 0);
});

test('findings carry confidence, line numbers and de-duplicated deep imports', async () => {
  const r = await analyze({
    'a/b/c/d.js': `import '../../../x.js';\nimport '../../../x.js';\nimport '../../../../y.js';`,
    'x.js': '', 'y.js': '',
  });
  const deep = r.issues.filter((i) => i.type === 'deep_import_nesting');
  assert.equal(deep.length, 2);
  assert.ok(deep.every((d) => d.confidence === 'heuristic' && d.line));
});

test('time budget and file cap are honoured and reported', async () => {
  const t = await analyze({ 'a.js': 'export const a=1', 'b.js': 'export const b=1' }, { timeBudgetMs: -1 });
  assert.ok(t.files.every((f) => f.parseStatus === 'skipped_timeout'));
  assert.equal(t.metrics.coverage.timedOut, true);
  assert.equal(t.metrics.coverage.completeness, 'partial');

  const c = await analyze({ 'z.js': 'export const z=1', 'a.md': '# a', 'b.md': '# b', 'c.md': '# c' }, { maxFiles: 2 });
  assert.equal(c.metrics.coverage.truncatedFiles, 2);
  assert.ok(c.files.some((f) => f.path === 'z.js'), 'source files are prioritised over docs when truncating');
});

test('analysis is deterministic', async () => {
  const files = { 'a.ts': `import './b.js'; import 'lodash';`, 'b.ts': `import './a.js';`, 'c.py': 'import os\nimport a' };
  const a = await analyze(files), b = await analyze(files);
  assert.deepEqual(a.dependencyGraph, b.dependencyGraph);
  assert.deepEqual(a.issues, b.issues);
});

// ------------------------------- Python / Go (heuristic analyzers) ---------------------------------
test('Python: strings/comments do not produce functions or imports; relative + package imports resolve', async () => {
  const r = await analyze({
    'pkg/__init__.py': '',
    'pkg/a.py': `"""docstring with def fake(): and import nothing"""\nimport os, sys as s\nfrom . import b\nfrom .c import thing\nfrom pkg.d import x\nimport requests\n# import commented\nx = "import hidden"\ndef f():\n    pass\nasync def g():\n    pass\n`,
    'pkg/b.py': 'def b(): pass', 'pkg/c.py': 'thing = 1', 'pkg/d.py': 'x = 1',
    'pkg/logging.py': '', 'pkg/e.py': 'import logging',
  });
  const a = r.files.find((f) => f.path === 'pkg/a.py')!;
  assert.equal(a.functionCount, 2);
  assert.equal(a.parseStatus, 'approximate');
  assert.deepEqual([...a.resolvedLocalDeps].sort(), ['pkg/b.py', 'pkg/c.py', 'pkg/d.py']);
  assert.deepEqual(r.dependencyGraph.filter((e) => e.source === 'pkg/e.py').map((e) => `${e.type}:${e.target}`), ['builtin:logging']); // not shadowed by pkg/logging.py
  assert.equal(r.metrics.supportStatus.functionsStatus, 'partial');
  assert.deepEqual(r.metrics.supportStatus.partialLanguages, ['Python']);
});

test('Go: counts func declarations; dependency metrics are N/A', async () => {
  const r = await analyze({ 'main.go': `package main\n// func commented() {}\nvar s = "func str() {}"\nfunc main() {\n  f := func() {}\n  _ = f\n}\nfunc (t T) Method() {}\n` });
  assert.equal(r.metrics.functions, 2);
  assert.equal(r.metrics.dependencies, null);
  assert.equal(r.metrics.supportStatus.functionsStatus, 'partial');
  assert.equal(r.metrics.supportStatus.dependenciesStatus, 'unsupported');
});
