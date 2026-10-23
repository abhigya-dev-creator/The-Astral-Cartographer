/**
 * Lightweight analyzers for languages without a bundled parser. They are token-aware (comments and
 * string/docstring contents are removed before matching) but they are NOT parsers, so every result
 * produced here is reported with support level "partial" and never as a verified exact number.
 */

export interface LogicalLine {
  text: string;
  line: number;
}

// ---------------------------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------------------------

/** Remove `#` comments and blank out string / docstring contents. Newlines and offsets are preserved. */
export function scrubPython(code: string): string {
  const out: string[] = [];
  const n = code.length;
  let i = 0;
  const keepNl = (c: string) => (c === '\n' || c === '\r' ? c : ' ');
  while (i < n) {
    const c = code[i];
    if (c === '#') {
      while (i < n && code[i] !== '\n') { out.push(' '); i++; }
    } else if (c === '"' || c === "'") {
      const triple = code[i + 1] === c && code[i + 2] === c;
      if (triple) {
        out.push(c, c, c); i += 3;
        while (i < n && !(code[i] === c && code[i + 1] === c && code[i + 2] === c)) {
          if (code[i] === '\\' && i + 1 < n) { out.push(' ', keepNl(code[i + 1])); i += 2; continue; }
          out.push(keepNl(code[i])); i++;
        }
        if (i < n) { out.push(c, c, c); i += 3; }
      } else {
        out.push(c); i++;
        while (i < n && code[i] !== c && code[i] !== '\n') {
          if (code[i] === '\\' && i + 1 < n) { out.push(' ', keepNl(code[i + 1])); i += 2; continue; }
          out.push(' '); i++;
        }
        if (i < n && code[i] === c) { out.push(c); i++; }
      }
    } else {
      out.push(c); i++;
    }
  }
  return out.join('');
}

/** Join backslash continuations and bracketed multi-line statements into logical lines. */
export function logicalLines(scrubbed: string): LogicalLine[] {
  const res: LogicalLine[] = [];
  let buf = '';
  let start = 1;
  let line = 1;
  let depth = 0;
  for (let i = 0; i < scrubbed.length; i++) {
    const c = scrubbed[i];
    if (c === '\r') continue;
    if (c === '\n') {
      line++;
      if (buf.endsWith('\\')) { buf = buf.slice(0, -1) + ' '; continue; }
      if (depth > 0) { buf += ' '; continue; }
      res.push({ text: buf, line: start });
      buf = ''; start = line;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    if (buf === '') start = line;
    buf += c;
  }
  if (buf.trim() !== '') res.push({ text: buf, line: start });
  return res;
}

export interface PyImport {
  /** module path without leading dots, e.g. "pkg.sub" (may be empty for `from . import x`) */
  module: string;
  /** number of leading dots (0 = absolute) */
  level: number;
  /** imported names for `from X import a, b` (used to resolve submodules) */
  names: string[];
  line: number;
}

export interface PythonResult {
  functionCount: number;
  imports: PyImport[];
}

export function analyzePython(code: string): PythonResult {
  const lines = logicalLines(scrubPython(code));
  let functionCount = 0;
  const imports: PyImport[] = [];

  for (const ll of lines) {
    const t = ll.text.trim();
    if (!t) continue;
    if (/^(?:async\s+)?def\s+[A-Za-z_]\w*/.test(t)) functionCount++;

    for (const stmt of t.split(';')) {
      const s = stmt.trim();
      let m = /^import\s+(.+)$/.exec(s);
      if (m) {
        for (const part of m[1].split(',')) {
          const mod = /^\s*([A-Za-z_][\w.]*)/.exec(part);
          if (mod) imports.push({ module: mod[1], level: 0, names: [], line: ll.line });
        }
        continue;
      }
      m = /^from\s+(\.*)\s*([A-Za-z_][\w.]*)?\s+import\s+(.+)$/.exec(s);
      if (m) {
        const names = m[3]
          .replace(/[()]/g, ' ')
          .split(',')
          .map((x) => /^\s*([A-Za-z_]\w*|\*)/.exec(x)?.[1])
          .filter((x): x is string => !!x);
        imports.push({ module: m[2] || '', level: m[1].length, names, line: ll.line });
      }
    }
  }
  return { functionCount, imports };
}

// ---------------------------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------------------------

/** Remove // and block comments; blank out interpreted strings, raw strings and rune literals. */
export function scrubGo(code: string): string {
  const out: string[] = [];
  const n = code.length;
  let i = 0;
  const keepNl = (c: string) => (c === '\n' || c === '\r' ? c : ' ');
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') { out.push(' '); i++; }
    } else if (c === '/' && d === '*') {
      out.push(' ', ' '); i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { out.push(keepNl(code[i])); i++; }
      if (i < n) { out.push(' ', ' '); i += 2; }
    } else if (c === '`') {
      out.push('`'); i++;
      while (i < n && code[i] !== '`') { out.push(keepNl(code[i])); i++; }
      if (i < n) { out.push('`'); i++; }
    } else if (c === '"' || c === "'") {
      out.push(c); i++;
      while (i < n && code[i] !== c && code[i] !== '\n') {
        if (code[i] === '\\' && i + 1 < n) { out.push(' ', keepNl(code[i + 1])); i += 2; continue; }
        out.push(' '); i++;
      }
      if (i < n && code[i] === c) { out.push(c); i++; }
    } else {
      out.push(c); i++;
    }
  }
  return out.join('');
}

export interface GoResult {
  /** number of top-level `func` declarations (functions and methods); closures are NOT counted */
  functionCount: number;
}

export function analyzeGo(code: string): GoResult {
  const scrubbed = scrubGo(code);
  const matches = scrubbed.match(/^func[ \t(]/gm);
  return { functionCount: matches ? matches.length : 0 };
}
