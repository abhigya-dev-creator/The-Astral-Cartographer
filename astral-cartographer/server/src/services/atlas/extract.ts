import { parse } from '@babel/parser';
import type { EdgeKind, FunctionInfo } from './types.js';

/** An import-like reference found in source. `specifier: null` = non-literal path (cannot be resolved statically). */
export interface FoundImport {
  specifier: string | null;
  kind: EdgeKind;
  line: number;
}

export interface Extracted {
  imports: FoundImport[];
  functions: FunctionInfo[];
  exports: string[];
  complexity: number;
  tokens: number;
  /** first syntax error message; set for recovered parses too (results are then best-effort) */
  parseError?: string;
  /** true when no parser attempt produced an AST: imports/functions are empty */
  failed: boolean;
}

// Same plugin strategy as services/analysis/jsParser.ts so both parsers accept the same code.
const BASE_PLUGINS: any[] = ['decorators-legacy', 'exportDefaultFrom', 'importAttributes', 'explicitResourceManagement'];
const TS = new Set(['.ts', '.mts', '.cts']);

function pluginAttempts(ext: string): any[][] {
  if (ext === '.tsx') return [['typescript', 'jsx'], ['typescript']];
  if (TS.has(ext)) return [['typescript'], ['typescript', 'jsx']];
  return [['jsx'], ['jsx', 'flow'], ['typescript', 'jsx']];
}

function literalValue(node: any): string | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range']);
const DECISION = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'CatchClause', 'ConditionalExpression']);

function keyName(key: any): string | null {
  if (!key) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateName') return `#${key.id?.name ?? ''}`;
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value);
  return null; // computed keys: no static name
}

function patternNames(p: any, out: string[]): void {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': for (const prop of p.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out); break;
    case 'ArrayPattern': for (const el of p.elements) patternNames(el, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
  }
}

function isFn(n: any): boolean {
  return n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression';
}

/** Parse one JS/TS file and extract everything the Atlas stores. Never throws. */
export function extractFile(code: string, ext: string): Extracted {
  let lastError = '';
  for (const extra of pluginAttempts(ext)) {
    let ast: any;
    try {
      ast = parse(code, {
        sourceType: 'unambiguous',
        plugins: [...BASE_PLUGINS, ...extra],
        errorRecovery: true,
        tokens: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowSuperOutsideMethod: true,
        allowUndeclaredExports: true,
      });
    } catch (err: any) {
      lastError = String(err?.message || err).slice(0, 200);
      continue;
    }
    const result = walkProgram(ast);
    const errors: any[] = ast.errors || [];
    if (errors.length) result.parseError = String(errors[0]?.message || 'syntax error').slice(0, 200);
    return result;
  }
  return { imports: [], functions: [], exports: [], complexity: 1, tokens: 0, parseError: lastError || 'could not parse', failed: true };
}

function walkProgram(ast: any): Extracted {
  const imports: FoundImport[] = [];
  const functions: FunctionInfo[] = [];
  const exports = new Set<string>();
  let decisions = 0;
  const line = (n: any): number => n?.loc?.start?.line ?? 0;
  const addImport = (src: any, kind: EdgeKind, at: any) => imports.push({ specifier: literalValue(src), kind, line: line(at) });

  const visit = (node: any, parent: any): void => {
    if (!node || typeof node.type !== 'string') return;
    const t = node.type;

    // ---- complexity -------------------------------------------------------------------------
    if (DECISION.has(t)) decisions++;
    else if (t === 'SwitchCase' && node.test) decisions++;
    else if (t === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||' || node.operator === '??')) decisions++;

    // ---- imports / exports ------------------------------------------------------------------
    switch (t) {
      case 'ImportDeclaration':
        addImport(node.source, 'import', node);
        break;
      case 'ExportAllDeclaration':
        addImport(node.source, 'reexport', node);
        exports.add(node.exported ? node.exported.name ?? String(node.exported.value) : '*');
        break;
      case 'ExportNamedDeclaration':
        if (node.source) addImport(node.source, 'reexport', node);
        for (const s of node.specifiers || []) {
          const name = s.exported?.name ?? s.exported?.value;
          if (name) exports.add(String(name));
        }
        if (node.declaration) {
          const d = node.declaration;
          if (d.type === 'VariableDeclaration') {
            const names: string[] = [];
            for (const decl of d.declarations) patternNames(decl.id, names);
            names.forEach((n) => exports.add(n));
          } else if (d.id?.name) exports.add(d.id.name);
        }
        break;
      case 'ExportDefaultDeclaration':
        exports.add('default');
        break;
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference?.type === 'TSExternalModuleReference') addImport(node.moduleReference.expression, 'require', node);
        break;
      case 'TSImportType':
        addImport(node.argument ?? node.parameter, 'import', node);
        break;
      case 'ImportExpression':
        addImport(node.source, 'dynamic', node);
        break;
      case 'CallExpression': {
        const c = node.callee;
        if (c?.type === 'Import') addImport(node.arguments[0], 'dynamic', node);
        else if (c?.type === 'Identifier' && c.name === 'require' && node.arguments.length >= 1) addImport(node.arguments[0], 'require', node);
        break;
      }
    }

    // ---- named functions, classes, methods --------------------------------------------------
    switch (t) {
      case 'FunctionDeclaration':
        functions.push({ name: node.id?.name ?? 'default', line: line(node), kind: 'function' });
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id?.name || parent?.type === 'ExportDefaultDeclaration') {
          functions.push({ name: node.id?.name ?? 'default', line: line(node), kind: 'class' });
        }
        break;
      case 'ClassMethod':
      case 'ClassPrivateMethod':
      case 'ObjectMethod': {
        const name = keyName(node.key);
        if (name) functions.push({ name, line: line(node), kind: 'method' });
        break;
      }
      case 'ClassProperty':
      case 'ClassPrivateProperty': {
        const name = keyName(node.key);
        if (name && isFn(node.value)) functions.push({ name, line: line(node), kind: 'method' });
        break;
      }
      case 'VariableDeclarator':
        if (node.id?.type === 'Identifier' && isFn(node.init)) functions.push({ name: node.id.name, line: line(node), kind: 'function' });
        break;
    }

    for (const key in node) {
      if (SKIP_KEYS.has(key)) continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') visit(c, node);
      } else if (v && typeof v.type === 'string') visit(v, node);
    }
  };

  visit(ast.program, null);
  const tokens = (ast.tokens || []).filter((tk: any) => !(typeof tk.type === 'string' && tk.type.startsWith('Comment'))).length;
  functions.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return { imports, functions, exports: [...exports].sort(), complexity: 1 + decisions, tokens, failed: false };
}
