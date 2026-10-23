import { builtinModules } from 'node:module';

/** Bump whenever counting definitions or rules change, so stale analyses are re-run instead of reused. */
export const ANALYZER_VERSION = '2.2.0'; // 2.2.0: Dependency Atlas links Java files; 2.1.0: trailing-slash directory imports resolve; Dependency Atlas generated

export type SupportLevel = 'full' | 'partial' | 'unsupported' | 'n/a';

export interface LanguageInfo {
  name: string;
  /** true for programming languages whose function/dependency metrics a user would expect */
  isCode: boolean;
  /** how well functions are counted for this language */
  functions: 'full' | 'approx' | 'none';
  /** how well imports/dependencies are extracted for this language */
  dependencies: 'full' | 'approx' | 'none';
}

const code = (name: string, functions: LanguageInfo['functions'], dependencies: LanguageInfo['dependencies']): LanguageInfo => ({
  name,
  isCode: true,
  functions,
  dependencies,
});
const data = (name: string): LanguageInfo => ({ name, isCode: false, functions: 'none', dependencies: 'none' });

const TS = code('TypeScript', 'full', 'full');
const JS = code('JavaScript', 'full', 'full');
const PY = code('Python', 'approx', 'approx'); // regex-based, comment/string aware (see pythonAnalyzer.ts)
const GO = code('Go', 'approx', 'none'); // func declarations only; imports not analysed
const unsup = (n: string) => code(n, 'none', 'none');

/** Extension -> language. Unknown extensions fall back to "Other" (treated as non-code). */
export const EXT_LANGUAGE: Record<string, LanguageInfo> = {
  '.ts': TS, '.tsx': TS, '.mts': TS, '.cts': TS,
  '.js': JS, '.jsx': JS, '.mjs': JS, '.cjs': JS,
  '.py': PY, '.pyi': PY,
  '.go': GO,
  '.java': unsup('Java'),
  '.kt': unsup('Kotlin'), '.kts': unsup('Kotlin'),
  '.scala': unsup('Scala'),
  '.rs': unsup('Rust'),
  '.c': unsup('C'),
  '.cc': unsup('C++'), '.cpp': unsup('C++'), '.cxx': unsup('C++'),
  '.h': unsup('C/C++ Header'), '.hpp': unsup('C++ Header'),
  '.cs': unsup('C#'),
  '.rb': unsup('Ruby'),
  '.php': unsup('PHP'),
  '.swift': unsup('Swift'),
  '.m': unsup('Objective-C'), '.mm': unsup('Objective-C'),
  '.dart': unsup('Dart'),
  '.lua': unsup('Lua'),
  '.r': unsup('R'),
  '.pl': unsup('Perl'), '.pm': unsup('Perl'),
  '.ex': unsup('Elixir'), '.exs': unsup('Elixir'),
  '.erl': unsup('Erlang'),
  '.hs': unsup('Haskell'),
  '.clj': unsup('Clojure'),
  '.groovy': unsup('Groovy'),
  '.zig': unsup('Zig'),
  '.sol': unsup('Solidity'),
  '.sh': unsup('Shell'), '.bash': unsup('Shell'), '.zsh': unsup('Shell'),
  '.ps1': unsup('PowerShell'),
  '.vue': unsup('Vue'),
  '.svelte': unsup('Svelte'),
  '.astro': unsup('Astro'),
  '.sql': unsup('SQL'),
  '.ipynb': unsup('Jupyter Notebook'),
  '.json': data('JSON'), '.jsonc': data('JSON'),
  '.css': data('CSS'), '.scss': data('SCSS'), '.sass': data('SCSS'), '.less': data('LESS'),
  '.html': data('HTML'), '.htm': data('HTML'),
  '.md': data('Markdown'), '.mdx': data('Markdown'), '.rst': data('Markdown'), '.txt': data('Text'),
  '.yaml': data('YAML'), '.yml': data('YAML'),
  '.toml': data('TOML'), '.xml': data('XML'), '.ini': data('INI'), '.graphql': data('GraphQL'), '.gql': data('GraphQL'),
  '.proto': data('Protocol Buffers'),
};

export const OTHER_LANGUAGE: LanguageInfo = data('Other');

export function languageFor(ext: string): LanguageInfo {
  return EXT_LANGUAGE[ext.toLowerCase()] ?? OTHER_LANGUAGE;
}

/** Extensions parsed with Babel (full AST support). */
export const JS_TS_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
export const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** Back-compat export: AST-supported extensions. */
export const AST_SUPPORTED_EXTS = JS_TS_EXTS;
/** Back-compat export: extensions eligible for architectural rules. */
export const ARCHITECTURAL_RULE_ELIGIBLE_EXTS = JS_TS_EXTS;

/** Back-compat export: language name -> AST supported. */
export const CODE_LANGUAGE_SUPPORT: Record<string, boolean> = Object.fromEntries(
  Object.values(EXT_LANGUAGE)
    .filter((l) => l.isCode)
    .map((l) => [l.name, l.functions === 'full' && l.dependencies === 'full'])
);

// ---------------------------------------------------------------------------------------------
// Discovery rules
// ---------------------------------------------------------------------------------------------

/** Directory names that are never analysed (third-party, VCS, build output, caches). Reported, never silent. */
export const IGNORED_DIR_NAMES = new Set([
  'node_modules', 'bower_components', 'jspm_packages', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.output', '.cache', '.turbo', '.parcel-cache',
  'tmp', 'temp', 'vendor', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.idea',
  '__MACOSX',
]);

export const BINARY_OR_ASSET_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif', '.bmp', '.tiff', '.psd',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.flac',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.jar', '.war', '.class', '.o', '.a', '.obj', '.pyc', '.pyo', '.wasm', '.bin',
  '.db', '.sqlite', '.sqlite3', '.dat', '.pack', '.idx', '.node',
]);

export const LOCKFILE_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'cargo.lock', 'composer.lock', 'gemfile.lock', 'poetry.lock', 'pipfile.lock', 'go.sum', 'uv.lock', 'mix.lock',
  'pubspec.lock', 'packages.lock.json', 'flake.lock',
]);

export const MINIFIED_SUFFIXES = ['.min.js', '.min.mjs', '.min.cjs', '.min.css', '.bundle.js', '.chunk.js', '.js.map', '.css.map', '.map'];

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------
export const LIMITS = {
  /** maximum included files stored/analysed; extra files are counted but dropped (reported as truncation) */
  MAX_FILES: 5000,
  /** JS/TS/Python/Go files above this are not parsed (reported as skipped_large) */
  MAX_PARSE_BYTES: 1_500_000,
  /** wall-clock budget for the analysis phase */
  ANALYSIS_TIME_BUDGET_MS: 120_000,
};

// ---------------------------------------------------------------------------------------------
// Node.js builtins (authoritative: taken from the running Node.js)
// ---------------------------------------------------------------------------------------------
/** Builtins that only exist behind the `node:` prefix (bare `test` is an npm package, not a builtin). */
export const NODE_PREFIX_ONLY = new Set<string>(['test', 'test/reporters', 'sqlite', 'sea']);
export const NODE_BUILTINS = new Set<string>();
for (const m of builtinModules) {
  if (m.startsWith('_')) continue;
  if (m.startsWith('node:')) NODE_PREFIX_ONLY.add(m.slice(5));
  else NODE_BUILTINS.add(m);
}

export function isNodeBuiltin(spec: string, hasNodePrefix: boolean): boolean {
  if (NODE_PREFIX_ONLY.has(spec)) return hasNodePrefix;
  return NODE_BUILTINS.has(spec);
}

export const METRIC_DEFINITIONS = {
  totalFiles: 'Files that passed discovery (text files not excluded as binaries, assets, lockfiles, minified bundles or ignored directories). Includes docs/config/data.',
  functions:
    'Function-like constructs that have a body: function declarations, function expressions, arrow functions, class methods (incl. constructors, getters/setters, static, private), and object-literal methods. Overload/declare signatures and interface members are not counted. Python counts `def`/`async def`; Go counts top-level `func` declarations (both approximate; lambdas/closures excluded).',
  dependencies: 'Dependency graph edges (unique source-file → target pairs, across local, external and built-in targets). This is NOT the number of packages.',
  externalPackages: 'Unique third-party package names imported (scoped packages and sub-paths collapsed to the package name).',
  builtInModules: 'Unique Node.js (or Python stdlib) built-in modules imported.',
  localDependencies: 'Unique in-repository files that are imported by at least one other file (resolved targets).',
  dependencyLinks: 'Total unique graph edges (same as `dependencies`).',
  unresolvedLocalImports: 'Unique (file, specifier) pairs for relative/alias/workspace imports that could not be mapped to a file in the repository.',
  rawImportStatements: 'Every import/require/re-export/dynamic-import occurrence with a static specifier, before de-duplication.',
  architecturalIssues: 'Number of architectural findings (confirmed + heuristic). See each finding’s `confidence`.',
};
