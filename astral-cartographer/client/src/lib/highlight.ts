/**
 * Small JS/TS/JSX syntax tokenizer for read-only code views (no dependencies).
 * Handles comments, strings, template literals with nested ${...}, regex vs. division, JSX tags/attributes/text,
 * and TypeScript generics/annotations (never mistaken for JSX in .ts files, nor after an identifier in .tsx).
 */
export type TokenClass = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'regex' | 'tag' | 'attr' | 'type' | 'fn' | 'punct';

export interface Token {
  c: TokenClass;
  v: string;
}

const KEYWORDS = new Set(
  ('abstract as async await break case catch class const continue debugger declare default delete do else enum export extends ' +
    'false finally for from function get if implements import in infer instanceof interface is keyof let module namespace new null ' +
    'of override private protected public readonly return satisfies set static super switch this throw true try type typeof undefined ' +
    'unique var void while with yield').split(' ')
);
/** after these keywords an expression starts, so `/` is a regex and `<` may open JSX */
const EXPR_KEYWORDS = new Set('return typeof instanceof in of new delete void throw case do else yield await extends'.split(' '));

type Mode = { m: 'code'; braces: number } | { m: 'template' } | { m: 'jsxTag'; named: boolean } | { m: 'jsxChildren' };

export function languageOf(path: string): 'ts' | 'tsx' | 'js' | 'jsx' | 'other' {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js';
  return 'other';
}

/** Tokenize source into lines of tokens. Unknown languages come back as plain text lines. */
export function tokenize(src: string, lang: ReturnType<typeof languageOf>): Token[][] {
  const lines: Token[][] = [[]];
  const push = (c: TokenClass, v: string) => {
    const parts = v.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) {
        const line = lines[lines.length - 1];
        const last = line[line.length - 1];
        if (last && last.c === c) last.v += p; else line.push({ c, v: p });
      }
    });
  };
  if (lang === 'other') {
    push('plain', src);
    return lines;
  }

  const jsxAllowed = lang !== 'ts';
  const stack: Mode[] = [{ m: 'code', braces: 0 }];
  /** last significant token, for regex/JSX decisions */
  let prev: { c: TokenClass; v: string } | null = null;
  const exprCanStart = () => {
    if (!prev) return true;
    if (prev.c === 'keyword') return EXPR_KEYWORDS.has(prev.v);
    if (prev.c === 'punct') return !/[)\]}]$/.test(prev.v) || prev.v === '}';
    return false; // identifier, number, string, regex, type, ...
  };
  const sig = (c: TokenClass, v: string) => { push(c, v); prev = { c, v }; };

  let i = 0;
  const n = src.length;
  const ident = /[A-Za-z_$ -￿][\w$ -￿]*/y;
  const num = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;

  const readString = (q: string) => {
    let j = i + 1;
    while (j < n && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
    sig('string', src.slice(i, Math.min(n, j + 1)));
    i = Math.min(n, j + 1);
  };

  while (i < n) {
    const mode = stack[stack.length - 1];
    const ch = src[i];

    // ---------------------------------------------------------------- template literal body
    if (mode.m === 'template') {
      let j = i;
      while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
      if (j > i) push('string', src.slice(i, j));
      i = j;
      if (i >= n) break;
      if (src[i] === '`') { push('string', '`'); stack.pop(); prev = { c: 'string', v: '`' }; i++; }
      else { push('punct', '${'); stack.push({ m: 'code', braces: 0 }); prev = { c: 'punct', v: '${' }; i += 2; }
      continue;
    }

    // ---------------------------------------------------------------- JSX children (text)
    if (mode.m === 'jsxChildren') {
      let j = i;
      while (j < n && src[j] !== '<' && src[j] !== '{') j++;
      if (j > i) push('plain', src.slice(i, j));
      i = j;
      if (i >= n) break;
      if (src[i] === '{') { push('punct', '{'); stack.push({ m: 'code', braces: 0 }); prev = { c: 'punct', v: '{' }; i++; continue; }
      if (src[i + 1] === '/') {
        // closing tag </Name>
        const end = src.indexOf('>', i);
        const stop = end === -1 ? n : end + 1;
        const inner = src.slice(i + 2, end === -1 ? n : end);
        push('punct', '</');
        push('tag', inner);
        if (end !== -1) push('punct', '>');
        i = stop;
        stack.pop(); // leave these children
        prev = { c: 'punct', v: ')' }; // a finished element behaves like a value
        continue;
      }
      push('punct', '<');
      stack.push({ m: 'jsxTag', named: false });
      i++;
      continue;
    }

    // ---------------------------------------------------------------- JSX tag (<Name attr="x" {...}>)
    if (mode.m === 'jsxTag') {
      if (/\s/.test(ch)) { push('plain', ch); i++; continue; }
      if (ch === '/' && src[i + 1] === '>') {
        push('punct', '/>'); i += 2; stack.pop(); prev = { c: 'punct', v: ')' };
        continue;
      }
      if (ch === '>') {
        push('punct', '>'); i++; stack.pop(); stack.push({ m: 'jsxChildren' });
        continue;
      }
      if (ch === '{') { push('punct', '{'); stack.push({ m: 'code', braces: 0 }); prev = { c: 'punct', v: '{' }; i++; continue; }
      if (ch === '"' || ch === "'") { readString(ch); continue; }
      const m = /[A-Za-z_$][\w$.:-]*/y;
      m.lastIndex = i;
      const r = m.exec(src);
      if (r) { push(mode.named ? 'attr' : 'tag', r[0]); mode.named = true; i += r[0].length; continue; }
      push('punct', ch); i++;
      continue;
    }

    // ---------------------------------------------------------------- code
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      push('comment', src.slice(i, end === -1 ? n : end));
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      push('comment', src.slice(i, end === -1 ? n : end + 2));
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (/\s/.test(ch)) { push('plain', ch); i++; continue; }
    if (ch === '"' || ch === "'") { readString(ch); continue; }
    if (ch === '`') { push('string', '`'); stack.push({ m: 'template' }); i++; continue; }
    if (ch === '/' && exprCanStart()) {
      // regex literal (character classes may contain '/')
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (src[j] === '/') {
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        sig('regex', src.slice(i, j));
        i = j;
        continue;
      }
    }
    if (ch === '<' && jsxAllowed && exprCanStart() && /[A-Za-z>]/.test(src[i + 1] ?? '')) {
      if (src[i + 1] === '>') { push('punct', '<>'); i += 2; stack.push({ m: 'jsxChildren' }); continue; } // fragment
      push('punct', '<');
      stack.push({ m: 'jsxTag', named: false });
      i++;
      continue;
    }
    if (ch === '{') { mode.braces++; sig('punct', '{'); i++; continue; }
    if (ch === '}') {
      if (mode.braces === 0 && stack.length > 1) {
        stack.pop();
        const outer = stack[stack.length - 1];
        if (outer.m === 'template') { push('punct', '}'); prev = { c: 'string', v: '' }; i++; continue; }
        push('punct', '}'); prev = { c: 'punct', v: ')' }; i++; continue; // end of a JSX expression
      }
      mode.braces = Math.max(0, mode.braces - 1);
      sig('punct', '}'); i++;
      continue;
    }
    num.lastIndex = i;
    const nm = /\d|\.\d/.test(src.slice(i, i + 2)) ? num.exec(src) : null;
    if (nm && nm[0]) { sig('number', nm[0]); i += nm[0].length; continue; }
    ident.lastIndex = i;
    const id = ident.exec(src);
    if (id) {
      const w = id[0];
      let c: TokenClass = 'plain';
      if (KEYWORDS.has(w) && prev?.v !== '.') c = 'keyword';
      else if (/^[A-Z]/.test(w)) c = 'type';
      else if (/^\s*(?:<[^>]*>)?\s*\(/.test(src.slice(i + w.length, i + w.length + 40))) c = 'fn';
      sig(c, w);
      i += w.length;
      continue;
    }
    // operators / punctuation (longest first)
    const op = /=>|\.\.\.|\?\?=?|\?\.|&&=?|\|\|=?|[=!]==?|[<>]=?|\*\*=?|[-+*/%&|^~!?:;,.()[\]=]/y;
    op.lastIndex = i;
    const o = op.exec(src);
    const v = o ? o[0] : ch;
    sig('punct', v);
    i += v.length;
  }
  return lines;
}
