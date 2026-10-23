import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageOf, tokenize, type Token, type TokenClass } from '../src/lib/highlight';

const flat = (src: string, path: string): Token[] => tokenize(src, languageOf(path)).flat();
/** class of the first token whose text equals or contains `needle` */
function cls(tokens: Token[], needle: string): TokenClass {
  const t = tokens.find((x) => x.v === needle) ?? tokens.find((x) => x.v.includes(needle));
  assert.ok(t, `token containing ${JSON.stringify(needle)} exists in ${JSON.stringify(tokens.map((x) => x.v))}`);
  return t!.c;
}
/** tokenization must be lossless */
const roundTrip = (src: string, path: string) => assert.equal(tokenize(src, languageOf(path)).map((l) => l.map((t) => t.v).join('')).join('\n'), src);

test('JSX: tags, attributes, attribute strings, expressions and text (apostrophes in text are not strings)', () => {
  const src = `export const App = () => (\n  <div className="app" onClick={() => go('x')}>\n    Don't panic {count}\n    <Button size='sm' />\n  </div>\n);`;
  roundTrip(src, 'App.tsx');
  const t = flat(src, 'App.tsx');
  assert.equal(cls(t, 'div'), 'tag');
  assert.equal(cls(t, 'className'), 'attr');
  assert.equal(cls(t, '"app"'), 'string');
  assert.equal(cls(t, 'Button'), 'tag');
  assert.equal(cls(t, "'sm'"), 'string');
  assert.equal(cls(t, "'x'"), 'string');
  assert.equal(cls(t, "Don't panic"), 'plain', 'JSX text');
  assert.equal(cls(t, 'count'), 'plain', 'expression inside JSX text');
  assert.equal(cls(t, ');'), 'punct', 'back in code after the element');
});

test('TypeScript generics and type annotations are never JSX', () => {
  const ts = `function map<T, U>(xs: Array<T>, f: (x: T) => U): Map<string, U[]> {\n  const s = useState<string | null>(null);\n  return new Map<string, U[]>() as Map<string, U[]>;\n}\nconst n = a < b && c > d;`;
  roundTrip(ts, 'x.ts');
  const t = flat(ts, 'x.ts');
  assert.ok(!t.some((x) => x.c === 'tag' || x.c === 'attr'), 'no JSX classes in a .ts file');
  assert.equal(cls(t, 'Array'), 'type');
  assert.equal(cls(t, 'Map'), 'type');
  assert.equal(cls(t, 'string'), 'plain');
  // same code in a .tsx file: generics follow an identifier, so still not JSX
  const tsx = `const s = useState<string | null>(null);\nconst m: Map<string, number> = new Map<string, number>();\nconst el = <Box<string> value="v" />;`;
  roundTrip(tsx, 'x.tsx');
  const t2 = tokenize(tsx, 'tsx');
  assert.ok(!t2[0].some((x) => x.c === 'tag'), 'useState<...>( is not JSX');
  assert.ok(!t2[1].some((x) => x.c === 'tag'), 'type annotation is not JSX');
  assert.ok(t2[2].some((x) => x.c === 'tag' && x.v === 'Box'), 'real JSX after = is a tag');
});

test('template literals with ${} (nested braces, nested templates, multi-line)', () => {
  const src = 'const s = `a ${obj.map((x) => ({ k: x }))} b ${`inner ${n + 1}`} c\nline2 ${"q"}`;\nconst after = 1;';
  roundTrip(src, 't.ts');
  const lines = tokenize(src, 'ts');
  const t = lines.flat();
  assert.equal(cls(t, '`a '), 'string');
  assert.equal(cls(t, ' b '), 'string');
  assert.equal(cls(t, 'inner '), 'string');
  assert.equal(cls(t, 'obj'), 'plain', 'expression inside ${} is code');
  assert.equal(cls(t, '"q"'), 'string');
  assert.equal(cls(t, 'line2 '), 'string', 'template continues on the next line');
  assert.equal(lines[2].find((x) => x.v === 'const')?.c, 'keyword', 'code after the template is code again');
});

test('regex literals vs. division', () => {
  const src = 'const re = /a\\/b[/]c/gi;\nconst d = total / count / 2;\nif (/^x/.test(s)) return /y/;\nconst e = arr[0] / 2;';
  roundTrip(src, 'r.js');
  const lines = tokenize(src, 'js');
  assert.equal(lines[0].find((x) => x.v.startsWith('/a'))?.v, '/a\\/b[/]c/gi');
  assert.equal(lines[0].find((x) => x.v.startsWith('/a'))?.c, 'regex');
  assert.ok(!lines[1].some((x) => x.c === 'regex'), 'division is not a regex');
  assert.equal(lines[2].filter((x) => x.c === 'regex').length, 2);
  assert.ok(!lines[3].some((x) => x.c === 'regex'), 'after ] it is division');
});

test('comments (line, block, multi-line) containing quotes and slashes', () => {
  const src = "// it's a 'comment' with /slashes/\nconst a = 1; /* block \"quoted\"\n spans */ const b = 'x';";
  roundTrip(src, 'c.ts');
  const lines = tokenize(src, 'ts');
  assert.deepEqual(lines[0].map((x) => x.c), ['comment']);
  assert.equal(lines[1].find((x) => x.v.startsWith('/*'))?.c, 'comment');
  assert.equal(lines[2][0].c, 'comment', 'block comment continues');
  assert.equal(lines[2].find((x) => x.v === "'x'")?.c, 'string');
  assert.equal(lines[2].find((x) => x.v === 'const')?.c, 'keyword');
});

test('strings with escapes, numbers, keywords and unknown languages', () => {
  const t = flat(`const s = 'it\\'s'; const n = 0xff + 1_000n + 3.5e-2;`, 'n.js');
  assert.equal(cls(t, "'it\\'s'"), 'string');
  assert.equal(cls(t, '0xff'), 'number');
  assert.equal(cls(t, '1_000n'), 'number');
  assert.equal(cls(t, '3.5e-2'), 'number');
  assert.deepEqual(tokenize('a: 1\nb: "x"', languageOf('c.yaml')), [[{ c: 'plain', v: 'a: 1' }], [{ c: 'plain', v: 'b: "x"' }]]);
});
