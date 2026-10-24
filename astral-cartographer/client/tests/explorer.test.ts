import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFileTree,
  filterTree,
  flattenVisibleTree,
  getAncestorPaths,
  getFolderColor,
} from '../src/features/explorer/explorerTreeUtils';
import { generateFileSummary } from '../src/features/explorer/explorerSummary';
import type { ExplorerFileItem } from '../src/features/explorer/explorerTypes';

test('explorer tree utils: buildFileTree creates nested hierarchy with folder counts and alphabetization', () => {
  const files: ExplorerFileItem[] = [
    {
      path: 'src/components/ui/Button.tsx',
      name: 'Button.tsx',
      ext: '.tsx',
      folder: 'src/components/ui',
      size: 1024,
      lines: 86,
      kind: 'code',
      language: 'TSX',
      functions: [{ name: 'Button', line: 13, kind: 'function' }],
      exports: ['Button', 'ButtonProps'],
      outgoingDeps: [{ specifier: 'react', resolvedPath: null, isLocal: false, isExternal: true, isBuiltin: false }],
      incomingDeps: [],
      issues: [],
    },
    {
      path: 'src/components/ui/Card.tsx',
      name: 'Card.tsx',
      ext: '.tsx',
      folder: 'src/components/ui',
      size: 512,
      lines: 40,
      kind: 'code',
      language: 'TSX',
      functions: [{ name: 'Card', line: 5, kind: 'function' }],
      exports: ['Card'],
      outgoingDeps: [],
      incomingDeps: [],
      issues: [],
    },
    {
      path: 'src/index.ts',
      name: 'index.ts',
      ext: '.ts',
      folder: 'src',
      size: 256,
      lines: 20,
      kind: 'code',
      language: 'TS',
      functions: [],
      exports: [],
      outgoingDeps: [],
      incomingDeps: [],
      issues: [],
    },
  ];

  const root = buildFileTree(files);
  assert.equal(root.filesCount, 3);
  assert.equal(root.children.length, 1); // 'src'

  const srcNode = root.children[0];
  assert.equal(srcNode.name, 'src');
  assert.equal(srcNode.isFolder, true);
  // Folders first: components, then index.ts
  assert.equal(srcNode.children[0].name, 'components');
  assert.equal(srcNode.children[0].isFolder, true);
  assert.equal(srcNode.children[1].name, 'index.ts');
  assert.equal(srcNode.children[1].isFolder, false);

  // Auto-expand ancestors
  const ancestors = getAncestorPaths('src/components/ui/Button.tsx');
  assert.deepEqual(ancestors, ['', 'src', 'src/components', 'src/components/ui']);

  // Flatten tree with expanded folders
  const expanded = new Set(['src', 'src/components', 'src/components/ui']);
  const visible = flattenVisibleTree(root, expanded);
  assert.equal(visible.length, 6); // src, components, ui, Button.tsx, Card.tsx, index.ts
});

test('explorer tree utils: filterTree matches query and retains parent branch', () => {
  const files: ExplorerFileItem[] = [
    {
      path: 'components/Button.tsx',
      name: 'Button.tsx',
      ext: '.tsx',
      folder: 'components',
      size: 100,
      lines: 20,
      kind: 'code',
      language: 'TSX',
      functions: [],
      exports: [],
      outgoingDeps: [],
      incomingDeps: [],
      issues: [],
    },
    {
      path: 'components/Card.tsx',
      name: 'Card.tsx',
      ext: '.tsx',
      folder: 'components',
      size: 100,
      lines: 20,
      kind: 'code',
      language: 'TSX',
      functions: [],
      exports: [],
      outgoingDeps: [],
      incomingDeps: [],
      issues: [],
    },
  ];

  const root = buildFileTree(files);
  const filtered = filterTree(root, 'button');
  assert.ok(filtered);
  const comp = filtered.children[0];
  assert.equal(comp.name, 'components');
  assert.equal(comp.children.length, 1);
  assert.equal(comp.children[0].name, 'Button.tsx');
});

test('explorer summary: derives honest evidence-based narrative and badges without hallucinating AI', () => {
  const buttonFile: ExplorerFileItem = {
    path: 'components/ui/Button.tsx',
    name: 'Button.tsx',
    ext: '.tsx',
    folder: 'components/ui',
    size: 2048,
    lines: 86,
    kind: 'code',
    language: 'TypeScript',
    functions: [{ name: 'Button', line: 14, kind: 'function' }],
    exports: ['Button', 'ButtonProps'],
    outgoingDeps: [
      { specifier: 'react', resolvedPath: null, isLocal: false, isExternal: true, isBuiltin: false },
      { specifier: '@/lib/utils', resolvedPath: 'src/lib/utils.ts', isLocal: true, isExternal: false, isBuiltin: false },
    ],
    incomingDeps: [
      { path: 'components/Navbar.tsx', name: 'Navbar.tsx', folder: 'components', line: 4 },
      { path: 'pages/Home.tsx', name: 'Home.tsx', folder: 'pages', line: 12 },
    ],
    issues: [],
  };

  const sourceCode = `
import React from 'react';
import { cn } from '@/lib/utils';
interface ButtonProps { children: React.ReactNode; }
export function Button(props: ButtonProps) { return <button className={cn('btn')}>{props.children}</button>; }
`;

  const summary = generateFileSummary(buttonFile, sourceCode);
  assert.equal(summary.title, 'AI Summary');
  assert.ok(summary.description.includes('Button'));
  assert.ok(summary.description.includes('components/ui'));
  assert.ok(summary.badges.includes('React Component'));
  assert.ok(summary.badges.includes('UI Component'));
  assert.ok(summary.badges.includes('TypeScript'));
  assert.ok(summary.badges.includes('Reusable'));
  assert.match(summary.disclaimer, /no external AI service/i);
});

test('folder colors: deterministic color based on folder name', () => {
  const color1 = getFolderColor('components');
  const color2 = getFolderColor('components');
  assert.equal(color1, color2);
  assert.equal(typeof color1, 'string');
  assert.ok(color1.startsWith('#'));
});
