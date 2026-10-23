import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CodeAnalyzer } from '../services/analyzer.js';

async function analyzeRepository(dir: string) {
  const analyzer = new CodeAnalyzer(dir);
  return await analyzer.analyze();
}

function createTempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astral-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
  return dir;
}

describe('Analyzer Language Support & Metric Status', () => {
  it('returns null and unsupported status for Java-only repository', async () => {
    const repoDir = createTempRepo({
      'src/Main.java': `
        package com.example;
        public class Main {
          public static void main(String[] args) {
            System.out.println("Hello World");
          }
        }
      `,
      'pom.xml': `<project><modelVersion>4.0.0</modelVersion></project>`,
      'README.md': `# Test Java Repo`,
    });

    try {
      const result = await analyzeRepository(repoDir);

      assert.equal(result.metrics.totalFiles, 3, 'Should count all files');
      assert.equal(result.metrics.functions, null, 'Functions should be null (not 0)');
      assert.equal(result.metrics.dependencies, null, 'Dependencies should be null (not 0)');
      assert.equal(result.metrics.dependencyMetrics, null, 'dependencyMetrics should be null');

      assert.ok(result.metrics.supportStatus, 'supportStatus must be defined');
      assert.equal(result.metrics.supportStatus.functionsStatus, 'unsupported');
      assert.equal(result.metrics.supportStatus.dependenciesStatus, 'unsupported');
      assert.ok(result.metrics.supportStatus.unsupportedLanguages.includes('Java'));
      assert.ok(result.metrics.supportStatus.reason?.includes('Java AST analysis is not yet implemented'));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('distinguishes verified zero from unsupported metrics for JS repo with 0 functions', async () => {
    const repoDir = createTempRepo({
      'config.js': `
        // Just exports and constants, no function declarations
        export const API_URL = "https://api.example.com";
        export const TIMEOUT = 5000;
      `,
      'README.md': `# JS Config Repo`,
    });

    try {
      const result = await analyzeRepository(repoDir);

      assert.equal(result.metrics.totalFiles, 2);
      assert.strictEqual(result.metrics.functions, 0, 'Must be strictly 0 (verified zero), not null');
      assert.equal(result.metrics.supportStatus?.functionsStatus, 'supported');
      assert.equal(result.metrics.supportStatus?.dependenciesStatus, 'supported');
      assert.deepEqual(result.metrics.supportStatus?.supportedLanguages, ['JavaScript']);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('reports partial status for mixed language repositories', async () => {
    const repoDir = createTempRepo({
      'backend/App.java': `public class App {}`,
      'frontend/index.js': `
        export function greet(name) {
          return "Hello " + name;
        }
      `,
    });

    try {
      const result = await analyzeRepository(repoDir);

      assert.equal(result.metrics.totalFiles, 2);
      assert.equal(result.metrics.functions, 1);
      assert.equal(result.metrics.supportStatus?.functionsStatus, 'partial');
      assert.equal(result.metrics.supportStatus?.dependenciesStatus, 'partial');
      assert.ok(result.metrics.supportStatus?.supportedLanguages.includes('JavaScript'));
      assert.ok(result.metrics.supportStatus?.unsupportedLanguages.includes('Java'));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe('Analyzer Dependency Separation & Normalization', () => {
  it('correctly categorizes external packages, built-ins, and local dependencies', async () => {
    const repoDir = createTempRepo({
      'src/math.js': `
        export function add(a, b) { return a + b; }
      `,
      'src/index.js': `
        import fs from 'fs';
        import path from 'path';
        import { add } from './math';
        import axios from 'axios';
        import { get } from 'lodash/get';
        import { query } from '@tanstack/react-query/core';
        import missing from './does_not_exist';

        export function run() {
          return add(1, 2);
        }
      `,
    });

    try {
      const result = await analyzeRepository(repoDir);
      const dm = result.metrics.dependencyMetrics;
      assert.ok(dm, 'dependencyMetrics must be present');

      // Built-ins: fs, path => 2
      assert.equal(dm.builtInModules, 2, 'Should detect 2 built-in modules (fs, path)');

      // External packages: axios, lodash, @tanstack/react-query => 3
      assert.equal(dm.externalPackages, 3, 'Should normalize subpaths and detect 3 unique packages');

      // Local dependencies: src/math.js => 1
      assert.equal(dm.localDependencies, 1, 'Should resolve 1 local file');

      // Unresolved: ./does_not_exist => 1
      assert.equal(dm.unresolvedLocalImports, 1, 'Should track 1 unresolved local import');

      // Raw import statements: 7 imports in src/index.js
      assert.equal(dm.rawImportStatements, 7, 'Should track total raw import statements');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('deduplicates graph edges between the same source and target', async () => {
    const repoDir = createTempRepo({
      'src/utils.js': `
        export const A = 1;
        export const B = 2;
      `,
      'src/app.js': `
        import { A } from './utils';
        // Second import from same target file
        import { B } from './utils';

        export function compute() {
          return A + B;
        }
      `,
    });

    try {
      const result = await analyzeRepository(repoDir);

      const edgesToUtils = result.dependencyGraph.filter(
        (e) => e.source === 'src/app.js' && e.target === 'src/utils.js'
      );
      assert.equal(edgesToUtils.length, 1, 'Duplicate imports should produce only 1 graph edge');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe('Analyzer Architectural Rule Eligibility', () => {
  it('excludes non-source files (.html, .json, .md) from architectural issues', async () => {
    // Generate a 600-line HTML file and 600-line JSON file
    const longHtml = '<!-- Mockup line -->\n'.repeat(600);
    const longJson = '{\n' + '  "key": "value",\n'.repeat(600) + '  "end": true\n}';

    const repoDir = createTempRepo({
      'scratch_stitch/dashboard_mockup.html': longHtml,
      'data/schema.json': longJson,
      'docs/guide.md': '# Long Guide\n'.repeat(600),
      'src/clean.js': `export function clean() { return true; }`,
    });

    try {
      const result = await analyzeRepository(repoDir);

      // Verify that NO issues are reported for the HTML, JSON, or MD files
      const nonCodeIssues = result.issues.filter((issue) =>
        ['.html', '.json', '.md'].some((ext) => issue.file.endsWith(ext))
      );
      assert.equal(nonCodeIssues.length, 0, 'Non-source files must never trigger architectural issues');
      assert.equal(result.metrics.architecturalIssues, 0, 'Total issues should be 0');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('flags genuine architectural issues on eligible source files (.js, .ts)', async () => {
    // Generate a 600-line JS file
    const longJs = '// Code line\n'.repeat(600) + 'export function run() { return 42; }\n';

    const repoDir = createTempRepo({
      'src/oversized.js': longJs,
    });

    try {
      const result = await analyzeRepository(repoDir);

      const oversizedIssues = result.issues.filter((i) => i.type === 'oversized_file');
      assert.equal(oversizedIssues.length, 1, 'Should detect oversized_file on .js source code');
      assert.equal(result.metrics.architecturalIssues, 1);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
