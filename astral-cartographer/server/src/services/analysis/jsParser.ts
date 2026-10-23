import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import { TS_EXTS } from './languages.js';

const traverse: any = (babelTraverse as any).default?.default || (babelTraverse as any).default || babelTraverse;

/**
 * static  – `import x from 'a'`, side-effect imports (eager, runtime)
 * reexport– `export {x} from 'a'`, `export * from 'a'` (eager, runtime)
 * require – CommonJS `require('a')`, TS `import x = require('a')` (eager, runtime)
 * dynamic – `import('a')` (lazy, runtime)
 * type    – `import type …`, `export type … from`, `typeof import('a')` (erased at compile time)
 */
export type ImportKind = 'static' | 'reexport' | 'require' | 'dynamic' | 'type';

export interface RawImport {
  specifier: string;
  kind: ImportKind;
  line: number;
}

export interface FunctionKinds {
  declarations: number;
  expressions: number;
  arrows: number;
  methods: number;
  constructors: number;
  objectMethods: number;
}

export type ParseStatus = 'parsed' | 'recovered' | 'fallback';

export interface JsParseResult {
  status: ParseStatus;
  functionCount: number;
  functionKinds: FunctionKinds;
  imports: RawImport[];
  /** import()/require() calls whose argument is not a static string (cannot be resolved statically) */
  nonLiteralDynamic: number;
  warnings: string[];
}

export function emptyFunctionKinds(): FunctionKinds {
  return { declarations: 0, expressions: 0, arrows: 0, methods: 0, constructors: 0, objectMethods: 0 };
}

const BASE_PLUGINS: any[] = ['decorators-legacy', 'exportDefaultFrom', 'importAttributes', 'explicitResourceManagement'];

function pluginAttempts(ext: string): any[][] {
  if (ext === '.tsx') return [['typescript', 'jsx'], ['typescript']];
  if (TS_EXTS.has(ext)) return [['typescript'], ['typescript', 'jsx']]; // `<T>x` casts vs JSX ambiguity
  // .js/.jsx/.mjs/.cjs: JSX in plain .js is very common (CRA, Next), Flow is common in older React Native code.
  return [['jsx'], ['jsx', 'flow'], ['typescript', 'jsx']];
}

function literalValue(node: any): string | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

export function parseJsTs(code: string, ext: string): JsParseResult {
  let lastError = '';
  for (const extra of pluginAttempts(ext)) {
    try {
      const ast = parse(code, {
        sourceType: 'unambiguous',
        plugins: [...BASE_PLUGINS, ...extra],
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowSuperOutsideMethod: true,
        allowUndeclaredExports: true,
      });
      const result = extract(ast);
      const recoverable: any[] = (ast as any).errors || [];
      if (recoverable.length > 0) {
        result.status = 'recovered';
        result.warnings.push(
          `${recoverable.length} recoverable syntax error(s); first: ${String(recoverable[0]?.message || '').slice(0, 120)}`
        );
      }
      return result;
    } catch (err: any) {
      lastError = String(err?.message || err).slice(0, 160);
    }
  }
  return fallbackScan(code, lastError);
}

function extract(ast: any): JsParseResult {
  const kinds = emptyFunctionKinds();
  const imports: RawImport[] = [];
  let nonLiteralDynamic = 0;
  const line = (n: any): number => n?.loc?.start?.line ?? 0;

  const add = (spec: string | null, kind: ImportKind, node: any) => {
    if (spec !== null && spec !== '') imports.push({ specifier: spec, kind, line: line(node) });
  };

  traverse(ast, {
    noScope: true,

    // ---- functions: every function-like node that has a body --------------------------------
    FunctionDeclaration() { kinds.declarations++; },
    FunctionExpression() { kinds.expressions++; },
    ArrowFunctionExpression() { kinds.arrows++; },
    ClassMethod(p: any) { if (p.node.kind === 'constructor') kinds.constructors++; else kinds.methods++; },
    ClassPrivateMethod() { kinds.methods++; },
    ObjectMethod() { kinds.objectMethods++; },
    // TSDeclareFunction / TSDeclareMethod (overloads, `declare function`, abstract members) have no body: not counted.

    // ---- imports -----------------------------------------------------------------------------
    ImportDeclaration(p: any) {
      const n = p.node;
      const specs: any[] = n.specifiers || [];
      const typeOnly = n.importKind === 'type' || n.importKind === 'typeof' ||
        (specs.length > 0 && specs.every((s: any) => s.importKind === 'type' || s.importKind === 'typeof'));
      add(literalValue(n.source), typeOnly ? 'type' : 'static', n);
    },
    ExportNamedDeclaration(p: any) {
      if (p.node.source) add(literalValue(p.node.source), p.node.exportKind === 'type' ? 'type' : 'reexport', p.node);
    },
    ExportAllDeclaration(p: any) {
      add(literalValue(p.node.source), p.node.exportKind === 'type' ? 'type' : 'reexport', p.node);
    },
    TSImportEqualsDeclaration(p: any) {
      const ref = p.node.moduleReference;
      if (ref?.type === 'TSExternalModuleReference') {
        add(literalValue(ref.expression), p.node.importKind === 'type' ? 'type' : 'require', p.node);
      }
    },
    TSImportType(p: any) {
      const arg = p.node.argument ?? p.node.parameter;
      add(literalValue(arg), 'type', p.node);
    },
    ImportExpression(p: any) {
      const v = literalValue(p.node.source);
      if (v === null) nonLiteralDynamic++; else add(v, 'dynamic', p.node);
    },
    CallExpression(p: any) {
      const n = p.node;
      const callee = n.callee;
      if (callee.type === 'Import') {
        const v = literalValue(n.arguments[0]);
        if (v === null) nonLiteralDynamic++; else add(v, 'dynamic', n);
      } else if (callee.type === 'Identifier' && callee.name === 'require' && n.arguments.length >= 1) {
        const v = literalValue(n.arguments[0]);
        if (v === null) nonLiteralDynamic++; else add(v, 'require', n);
      }
    },
  });

  const functionCount =
    kinds.declarations + kinds.expressions + kinds.arrows + kinds.methods + kinds.constructors + kinds.objectMethods;
  return { status: 'parsed', functionCount, functionKinds: kinds, imports, nonLiteralDynamic, warnings: [] };
}

// ---------------------------------------------------------------------------------------------
// Fallback: used only when every Babel attempt throws. Results are approximate and flagged.
// ---------------------------------------------------------------------------------------------

/** Replace comments (and optionally string contents) with spaces, preserving newlines/offsets. */
export function scrubCLike(code: string, blankStrings: boolean): string {
  const out: string[] = [];
  const n = code.length;
  let i = 0;
  const blank = (c: string) => (c === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') { out.push(' '); i++; }
    } else if (c === '/' && d === '*') {
      out.push(' ', ' '); i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { out.push(blank(code[i])); i++; }
      if (i < n) { out.push(' ', ' '); i += 2; }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out.push(q); i++;
      while (i < n && code[i] !== q) {
        if (code[i] === '\\' && i + 1 < n) {
          out.push(blankStrings ? ' ' : code[i], blankStrings ? blank(code[i + 1]) : code[i + 1]);
          i += 2;
          continue;
        }
        if (q !== '`' && code[i] === '\n') break; // unterminated single-line string
        out.push(blankStrings ? blank(code[i]) : code[i]);
        i++;
      }
      if (i < n && code[i] === q) { out.push(q); i++; }
    } else {
      out.push(c); i++;
    }
  }
  return out.join('');
}

function fallbackScan(code: string, reason: string): JsParseResult {
  const noComments = scrubCLike(code, false);
  const noStrings = scrubCLike(code, true);
  const lineAt = (offset: number) => {
    let l = 1;
    for (let i = 0; i < offset; i++) if (noComments.charCodeAt(i) === 10) l++;
    return l;
  };

  const imports: RawImport[] = [];
  const seen = new Set<string>();
  const push = (spec: string, kind: ImportKind, offset: number) => {
    const key = `${kind}|${spec}|${offset}`;
    if (!seen.has(key) && spec) { seen.add(key); imports.push({ specifier: spec, kind, line: lineAt(offset) }); }
  };
  const patterns: Array<[RegExp, ImportKind]> = [
    [/\bimport\s+type\s+[^;'"]*?from\s*['"]([^'"\n]+)['"]/g, 'type'],
    [/\bimport\s+(?!type\b)(?:[\w$*\s{},]+?\s*from\s*)?['"]([^'"\n]+)['"]/g, 'static'],
    [/\bexport\s+(?:\*|\{[^}]*\})(?:\s+as\s+[\w$]+)?\s*from\s*['"]([^'"\n]+)['"]/g, 'reexport'],
    [/\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, 'require'],
    [/\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, 'dynamic'],
  ];
  for (const [re, kind] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(noComments)) !== null) push(m[1], kind, m.index);
  }

  const fnCount = (noStrings.match(/\bfunction\b/g) || []).length + (noStrings.match(/=>/g) || []).length;
  return {
    status: 'fallback',
    functionCount: fnCount,
    functionKinds: emptyFunctionKinds(),
    imports,
    nonLiteralDynamic: 0,
    warnings: [
      `Syntax could not be parsed (${reason || 'unknown error'}); imports and function counts are approximate (regex fallback; method shorthand not counted).`,
    ],
  };
}
