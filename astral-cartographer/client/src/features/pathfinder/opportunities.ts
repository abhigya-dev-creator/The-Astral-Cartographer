import type { IArchitecturalIssue } from '../../lib/api';
import type { FileNode } from '../atlas/model';
import { listNames, plural, type RepoFacts } from './repoFacts';

/**
 * Contributor Path: contribution opportunities derived from evidence only.
 *  - architectural findings of the analysis (confirmed or heuristic, as the analyzer labels them);
 *  - facts of the Dependency Atlas (which files tests import, unresolved imports, parse errors, file types, docs).
 * Every opportunity keeps its evidence and a certainty label; suggested steps are marked as suggestions in the UI.
 * Categories the analysis cannot see (accessibility, performance, error handling) are not generated.
 */

export type OppType = 'Bug Fix' | 'Testing' | 'Refactoring' | 'Architecture' | 'Documentation' | 'Type Safety' | 'Code Quality';
export type Effort = 'Low' | 'Medium' | 'High';
/** confirmed = confirmed analyzer finding; evidence = fact from the analysis; heuristic = threshold or pattern, verify first */
export type Certainty = 'confirmed' | 'evidence' | 'heuristic';

export interface Evidence { certainty: Certainty; text: string; path?: string; line?: number }
export interface OppFile { path: string; role: string; main?: boolean; /** false for suggested new files */ exists: boolean; line?: number }

export interface Opportunity {
  /** stable across re-analyses of unchanged code (used for saving) */
  id: string;
  title: string;
  summary: string;
  type: OppType;
  tags: string[];
  /** an estimate, always shown as one */
  effort: Effort;
  goodFirst: boolean;
  certainty: Certainty;
  areas: string[];
  files: OppFile[];
  evidence: Evidence[];
  /** architectural findings touching the files involved */
  related: IArchitecturalIssue[];
  why: string[];
  whyGood: string[];
  /** suggested approach (not verified) */
  steps: string[];
  tests: string[];
  score: number;
}

export interface OpportunityResult {
  list: Opportunity[];
  /** what could not be derived, shown to the user */
  limits: string[];
}

const CERTAINTY_RANK: Record<Certainty, number> = { confirmed: 3, evidence: 2.5, heuristic: 1 };
const EFFORT_RANK: Record<Effort, number> = { Low: 3, Medium: 2, High: 1 };
const JS_RE = /\.(js|jsx|mjs|cjs)$/i;
const TS_RE = /\.(ts|tsx|mts|cts)$/i;
const TOOL_CONFIG_RE = /(^|\/)[^/]*\.config\.[cm]?js$|(^|\/)\.?(eslint|prettier|babel|jest|postcss|tailwind|commitlint|stylelint)[^/]*\.[cm]?js$|(^|\/)(public|static|vendor|scripts|bin)\//i;
const BROKEN_REASONS = new Set(['file not found', 'alias not defined in tsconfig/jsconfig paths', 'workspace package entry not found']);

const effortForLines = (lines: number): Effort => (lines <= 150 ? 'Low' : lines <= 450 ? 'Medium' : 'High');

export function deriveOpportunities(facts: RepoFacts, issues: IArchitecturalIssue[] | null): OpportunityResult {
  const { data, isTest, fanIn, importedBy, imports, name, areaOf } = facts;
  const out: Opportunity[] = [];
  const limits: string[] = [];
  const issueList = issues ?? [];
  if (!issues) limits.push('Architectural findings are not available for this map, so circular dependencies, coupling and file-size findings are not included.');
  limits.push('Accessibility, performance and error-handling improvements need a review of the source code itself; the analysis cannot detect them, so none are suggested here.');

  const relatedTo = (paths: string[], exclude?: IArchitecturalIssue) => {
    const set = new Set(paths);
    return issueList.filter((i) => i !== exclude && (set.has(i.file) || (i.affectedFiles ?? []).some((p) => set.has(p))));
  };
  const push = (o: Omit<Opportunity, 'areas' | 'related' | 'score' | 'goodFirst'> & { exclude?: IArchitecturalIssue; impact?: number }) => {
    const paths = o.files.filter((f) => f.exists).map((f) => f.path);
    const goodFirst = o.effort === 'Low' && paths.length <= 3 && o.certainty !== 'heuristic';
    const { exclude, impact = 0, ...rest } = o;
    out.push({
      ...rest,
      goodFirst,
      areas: [...new Set(paths.map(areaOf))],
      related: relatedTo(paths, exclude),
      score: CERTAINTY_RANK[o.certainty] * 2 + EFFORT_RANK[o.effort] * 1.5 + (goodFirst ? 2 : 0) + Math.min(3, Math.log2(1 + impact)) - paths.length * 0.1,
    });
  };
  const testConvention = describeTests(facts);

  // ---- architectural findings ----------------------------------------------------------------
  const deep = new Map<string, IArchitecturalIssue[]>();
  for (const issue of issueList) {
    const files = [...new Set([issue.file, ...(issue.affectedFiles ?? [])])].filter((p) => facts.file(p));
    const certainty: Certainty = issue.confidence === 'confirmed' ? 'confirmed' : 'heuristic';
    const ev: Evidence = { certainty, text: `${issue.rule}: ${issue.description}`, path: issue.file, line: issue.line };
    switch (issue.type) {
      case 'circular_dependency': {
        const lazy = issue.severity === 'info';
        push({
          id: `finding:${issue.id ?? `${issue.type}:${files.join(',')}`}`,
          title: files.length === 2 ? `Break the circular import between ${name(files[0])} and ${name(files[1])}` : `Break a circular dependency among ${files.length} files`,
          summary: lazy ? 'These files import each other only through dynamic or type-only imports. It is not a load-time problem, but the loop makes the code harder to change.' : 'These files import each other, directly or through other files. Loops like this make load order fragile and the modules hard to change separately.',
          type: 'Architecture', tags: ['Architecture', 'Dependencies'],
          effort: files.length <= 2 ? (lazy ? 'Low' : 'Medium') : 'High', certainty,
          files: files.map((p, i) => ({ path: p, role: i === 0 ? 'Where the reported loop starts' : 'Part of the loop', main: i === 0, exists: true, line: i === 0 ? issue.line : undefined })),
          evidence: [ev],
          why: ['Circular imports can cause modules to be used before they are fully initialised.', 'They tie the files together: none of them can be reused or tested on its own.'],
          whyGood: files.length <= 3 ? ['The loop involves only a few files, so the change stays small.', 'The analysis will confirm the fix: the finding disappears after re-analysis.'] : ['It is a real structural improvement, and the analysis confirms when it is fixed.'],
          steps: [
            `Open ${name(files[0])}${issue.line ? ` at line ${issue.line}` : ''} and follow the imports around the loop.`,
            'Find what each file actually needs from the other: often one shared function, constant or type.',
            'Move that shared piece into a new module that both files import, or pass it in as a parameter instead of importing it.',
            'Re-run the analysis: the circular dependency finding should be gone.',
          ],
          tests: [`Run the existing tests that cover ${listNames(files.map(name), 3)}.`, testConvention ? `Add a test that imports each module on its own, following the existing convention (${testConvention}).` : 'Add a test that imports each module on its own.'],
          exclude: issue, impact: files.reduce((s, p) => s + fanIn(p), 0),
        });
        break;
      }
      case 'oversized_file':
      case 'high_coupling': {
        const f = facts.file(issue.file);
        if (!f) break;
        const big = issue.type === 'oversized_file';
        const fns = f.functions.filter((x) => x.kind !== 'method').map((x) => x.name);
        const dependents = importedBy(f.path).filter((l) => !isTest(l.path));
        push({
          id: `finding:${issue.id ?? `${issue.type}:${f.path}`}`,
          title: big ? `Split ${f.name} into smaller modules` : `Reduce the coupling of ${f.name}`,
          summary: big
            ? `${f.name} has ${plural(f.lines, 'line')}${fns.length ? ` and ${plural(fns.length, 'top-level function')}` : ''}, above the analyzer's size threshold. Splitting it by responsibility makes it easier to read and change.`
            : `${f.name} imports ${plural(imports(f.path).length, 'local module')} and is imported by ${plural(dependents.length, 'file')}, above the analyzer's coupling thresholds.`,
          type: big ? 'Refactoring' : 'Architecture', tags: big ? ['Refactoring', 'Code Structure'] : ['Architecture', 'Coupling'],
          effort: 'High', certainty,
          files: [
            { path: f.path, role: big ? 'The file to split' : 'The highly coupled module', main: true, exists: true },
            ...dependents.slice(0, 6).map((l) => ({ path: l.path, role: `Imports ${f.name} (line ${l.line}); update its import if things move`, exists: true, line: l.line })),
          ],
          evidence: [ev, { certainty: 'evidence', text: `${f.name} is imported by ${plural(dependents.length, 'non-test file')}.` }],
          why: big ? ['Large files mix responsibilities, so every change risks touching unrelated code.', 'Smaller modules are easier to review and test.'] : ['Highly coupled modules spread the effect of every change to many files.'],
          whyGood: ['It teaches you a central part of the codebase.', 'It can be done in small, separately reviewable steps.'],
          steps: [
            `Read ${f.name} and group its ${fns.length ? `functions (${listNames(fns, 4)})` : 'code'} by responsibility.`,
            'Move one group at a time into a new module next to it; keep the original exports working (re-export) until all importers are updated.',
            dependents.length ? `Update the ${plural(dependents.length, 'importing file')} (${listNames(dependents.map((l) => name(l.path)), 3)}) in a separate step.` : 'Check that nothing else imports the moved code.',
            'Re-run the analysis to confirm the finding is resolved.',
          ],
          tests: [facts.testedDirectly.has(f.path) ? `Tests already import ${f.name}; run them after each step.` : `No test imports ${f.name} directly. Add tests for its current behaviour before moving code${testConvention ? ` (${testConvention})` : ''}.`],
          exclude: issue, impact: dependents.length,
        });
        break;
      }
      case 'deep_import_nesting': {
        const area = areaOf(issue.file);
        deep.set(area, [...(deep.get(area) ?? []), issue]);
        break;
      }
    }
  }
  for (const [area, list] of deep) {
    const files = [...new Set(list.map((i) => i.file))];
    push({
      id: `deep-imports:${area}`,
      title: `Replace deep relative imports in ${area === '(root)' ? 'the repository root' : area}`,
      summary: `${plural(list.length, 'import')} in ${plural(files.length, 'file')} climb several folders ("../../../"). Path aliases or a shallower structure make them easier to read and move.`,
      type: 'Code Quality', tags: ['Code Quality', 'Imports'],
      effort: files.length <= 3 ? 'Low' : 'Medium', certainty: 'heuristic',
      files: files.map((p, i) => ({ path: p, role: `Has a deep import (${list.filter((x) => x.file === p).map((x) => `line ${x.line ?? '?'}`).join(', ')})`, main: i === 0, exists: true, line: list.find((x) => x.file === p)?.line })),
      evidence: list.slice(0, 8).map((i) => ({ certainty: 'heuristic' as const, text: i.description, path: i.file, line: i.line })),
      why: ['Deep relative paths break easily when files move and are hard to read.'],
      whyGood: ['Mechanical and low-risk; the analysis confirms the result.'],
      steps: ['Check whether the project already defines path aliases (for example in tsconfig.json or the bundler configuration).', 'If it does, switch these imports to the alias; if not, propose one in an issue before changing many files.', 'Run the build and tests.'],
      tests: ['No new tests are needed; run the existing build and test suite.'],
    });
  }

  // ---- unresolved imports and parse errors (analysis facts; may be generated code) ----------------
  const unresolvedByFile = new Map<string, { specifier: string; line: number; reason: string }[]>();
  for (const e of data.edges) {
    if (e.status !== 'unresolved' || !e.reason || !BROKEN_REASONS.has(e.reason)) continue;
    unresolvedByFile.set(e.from, [...(unresolvedByFile.get(e.from) ?? []), { specifier: e.specifier, line: e.line, reason: e.reason }]);
  }
  for (const [path, list] of unresolvedByFile) {
    push({
      id: `unresolved:${path}:${list.map((x) => x.specifier).sort().join('|')}`,
      title: `Check ${list.length === 1 ? 'an unresolved import' : `${list.length} unresolved imports`} in ${name(path)}`,
      summary: `The analyzer could not find the file${list.length === 1 ? '' : 's'} ${listNames(list.map((x) => `"${x.specifier}"`), 3)} ${list.length === 1 ? 'points' : 'point'} to. This may be a broken import, or a path created at build time; verify before changing it.`,
      type: 'Bug Fix', tags: ['Bug Fix', 'Imports'], effort: 'Low', certainty: 'heuristic',
      files: [{ path, role: `Contains the import${list.length === 1 ? '' : 's'} (line ${list.map((x) => x.line).join(', ')})`, main: true, exists: true, line: list[0].line }],
      evidence: list.map((x) => ({ certainty: 'evidence' as const, text: `"${x.specifier}" on line ${x.line}: ${x.reason}.`, path, line: x.line })),
      why: ['A broken import fails at build time or when that code runs.'],
      whyGood: ['Small and contained: one file, a few lines.'],
      steps: ['Open the file at the reported line and check what the import is meant to load.', 'Search the repository for the intended target: it may have been renamed or moved.', 'If the target is generated during the build, document that instead of changing the import.', 'Build the project to confirm.'],
      tests: ['Run the build and the tests that cover this file.'],
      impact: fanIn(path),
    });
  }
  for (const f of data.files.filter((x) => x.parseError)) {
    push({
      id: `parse-error:${f.path}`,
      title: `Investigate the parse error in ${f.name}`,
      summary: `The analyzer could not parse ${f.name} cleanly: "${f.parseError}". It may be a syntax error, or syntax the analyzer does not support.`,
      type: 'Bug Fix', tags: ['Bug Fix'], effort: 'Low', certainty: 'heuristic',
      files: [{ path: f.path, role: 'The file that failed to parse', main: true, exists: true }],
      evidence: [{ certainty: 'evidence', text: `Parser message: ${f.parseError}`, path: f.path }],
      why: ['If it is a real syntax error, the file cannot run.'],
      whyGood: ['Contained to one file.'],
      steps: ['Open the file and find the reported problem.', 'Check whether the project builds; if it does, the syntax is valid and the analyzer is the limitation.', 'Fix or report accordingly.'],
      tests: ['Run the build and the related tests.'],
    });
  }

  // ---- tests ---------------------------------------------------------------------------------
  const code = facts.codeFiles.filter((f) => !isTest(f.path) && !TOOL_CONFIG_RE.test(f.path));
  if (code.length >= 3 && facts.testFiles.length === 0) {
    const target = [...code].sort((a, b) => fanIn(b.path) - fanIn(a.path))[0];
    push({
      id: 'tests:first',
      title: 'Add the first automated test',
      summary: `No test files were found among the ${plural(data.files.length, 'analysed file')}. A first test for ${target.name}, the most widely imported module, would give the project a safety net.`,
      type: 'Testing', tags: ['Testing'], effort: 'Medium', certainty: 'evidence',
      files: [{ path: target.path, role: `Most imported module (${plural(fanIn(target.path), 'importer')})`, main: true, exists: true }],
      evidence: [{ certainty: 'evidence', text: 'No files matching common test patterns (*.test.*, *.spec.*, test/ or tests/ folders, src/test/, *Test.java, test_*.py) were found.' }],
      why: ['Without tests, every change has to be checked by hand.'],
      whyGood: ['A visible, welcome first contribution; maintainers can build on it.'],
      steps: ['Check the README and manifest for a preferred test framework; if there is none, propose one in an issue first.', `Write a small test for one function of ${target.name}.`, 'Add the command to run tests to the manifest and the README.'],
      tests: [`Start with ${target.name}: it is imported by ${plural(fanIn(target.path), 'file')}.`],
      impact: fanIn(target.path),
    });
  } else if (facts.testFiles.length) {
    const untested = code.filter((f) => fanIn(f.path) >= 2 && !facts.testedDirectly.has(f.path) && !/\.d\.[cm]?ts$/.test(f.path)).sort((a, b) => fanIn(b.path) - fanIn(a.path)).slice(0, 6);
    for (const f of untested) {
      const suggestion = suggestTestPath(facts, f);
      // a test with the expected name already exists but does not import the module: point at it instead of a new file
      const sameName = suggestion && facts.file(suggestion.path) ? suggestion.path : null;
      const dependents = importedBy(f.path).filter((l) => !isTest(l.path));
      // functions are what tests call; exported constants and types only when there are no functions
      const declared = f.functions.filter((x) => x.kind !== 'method').map((x) => x.name);
      const fns = declared.length ? declared : f.exports.filter((e) => e !== 'default');
      push({
        id: `tests:${f.path}`,
        title: `Add tests for ${f.name}`,
        summary: `${f.name} is imported by ${plural(dependents.length, 'file')}, but no test file imports it directly.${fns.length ? ` Tests for ${listNames(fns, 3)} would protect everything that depends on it.` : ''}`,
        type: 'Testing', tags: ['Testing', areaOf(f.path)], effort: effortForLines(f.lines), certainty: 'evidence',
        files: [
          { path: f.path, role: 'The module to test', main: true, exists: true },
          ...(sameName ? [{ path: sameName, role: `Existing test with a matching name. It does not import ${f.name} directly; check what it covers and extend it`, exists: true }]
            : suggestion ? [{ path: suggestion.path, role: `Suggested location for the new test (does not exist yet; follows ${suggestion.basedOn})`, exists: false }] : []),
          ...dependents.slice(0, 4).map((l) => ({ path: l.path, role: `Uses ${f.name} (line ${l.line}): shows how it is called`, exists: true, line: l.line })),
        ],
        evidence: [
          { certainty: 'evidence', text: `Imported by ${plural(dependents.length, 'non-test file')}: ${listNames(dependents.map((l) => name(l.path)), 4)}.` },
          { certainty: 'evidence', text: `None of the ${plural(facts.testFiles.length, 'test file')} in the repository imports it directly. It may still be exercised indirectly through other tests.` },
        ],
        why: [`A bug in ${f.name} would affect ${plural(dependents.length, 'file')}.`],
        whyGood: [f.lines <= 150 ? `The file is small (${plural(f.lines, 'line')}), so it is quick to understand.` : `It has ${plural(f.lines, 'line')}; start with its most used function.`, 'Adding tests does not change behaviour, so it is a safe first contribution.'],
        steps: [
          `Read ${f.name}${fns.length ? ` and list what it offers (${listNames(fns, 4)})` : ''}.`,
          dependents.length ? `Look at how ${listNames(dependents.slice(0, 2).map((l) => name(l.path)))} call${dependents.length === 1 ? 's' : ''} it to see realistic inputs.` : 'Find realistic inputs from the code itself.',
          sameName ? `Read ${sameName.slice(sameName.lastIndexOf('/') + 1)} first: it may test ${f.name} indirectly. Add direct tests there or next to it.`
            : suggestion ? `Create ${suggestion.path.slice(suggestion.path.lastIndexOf('/') + 1)} next to the existing tests and cover the normal case, an edge case and an error case.` : 'Create a test file and cover the normal case, an edge case and an error case.',
          'Run the whole test suite.',
        ],
        tests: [testConvention ? `Follow the existing convention: ${testConvention}.` : 'Follow the conventions of the existing tests.'],
        impact: dependents.length,
      });
    }
  }

  // ---- type safety: JavaScript files in an area that is otherwise TypeScript --------------------
  const areas = new Map<string, { ts: number; js: FileNode[] }>();
  for (const f of code) {
    const a = areas.get(areaOf(f.path)) ?? { ts: 0, js: [] };
    if (TS_RE.test(f.name)) a.ts++;
    else if (JS_RE.test(f.name)) a.js.push(f);
    areas.set(areaOf(f.path), a);
  }
  for (const [area, a] of areas) {
    if (a.ts < 5 || !a.js.length || a.js.length > a.ts) continue;
    const js = [...a.js].sort((x, y) => x.lines - y.lines);
    const total = js.reduce((s, f) => s + f.lines, 0);
    push({
      id: `typescript:${area}`,
      title: js.length === 1 ? `Convert ${js[0].name} to TypeScript` : `Convert ${js.length} JavaScript files in ${area} to TypeScript`,
      summary: `${area === '(root)' ? 'The repository root' : area} has ${plural(a.ts, 'TypeScript file')} and ${plural(js.length, 'JavaScript file')}. Converting ${js.length === 1 ? 'it' : 'them'} brings the same type checking to all of the code.`,
      type: 'Type Safety', tags: ['TypeScript', 'Type Safety'], effort: total <= 200 ? 'Low' : total <= 800 ? 'Medium' : 'High', certainty: 'evidence',
      files: js.slice(0, 8).map((f, i) => ({ path: f.path, role: `JavaScript file (${plural(f.lines, 'line')})`, main: i === 0, exists: true })),
      evidence: [{ certainty: 'evidence', text: `${plural(a.ts, 'TypeScript file')} and ${plural(js.length, 'JavaScript file')} (${listNames(js.map((f) => f.name), 4)}) in ${area}. Tool configuration files are not counted.` }],
      why: ['Type checking catches mistakes in the JavaScript files that it already catches elsewhere.'],
      whyGood: js.length <= 2 ? ['Only a few small files.'] : ['Can be done one file at a time.'],
      steps: ['Rename one file at a time to .ts or .tsx.', 'Fix the type errors the compiler reports, adding types for function parameters first.', 'Make sure the build and tests pass after each file.'],
      tests: ['Run the type check (tsc) and the existing tests after each file.'],
      impact: js.reduce((s, f) => s + fanIn(f.path), 0),
    });
  }

  // ---- documentation -------------------------------------------------------------------------
  const readmes = data.files.filter((f) => /^readme(\.[a-z]+)?$/i.test(f.name));
  const rootReadme = readmes.find((f) => !f.path.includes('/') || f.folder === facts.rootPath);
  if (!readmes.length) {
    push({
      id: 'docs:readme', title: 'Add a README',
      summary: 'No README was found. A short description, setup steps and an overview of the folders help every new contributor.',
      type: 'Documentation', tags: ['Documentation'], effort: 'Medium', certainty: 'evidence',
      files: [{ path: 'README.md', role: 'Suggested new file (does not exist yet)', main: true, exists: false }],
      evidence: [{ certainty: 'evidence', text: 'No file named README was found among the analysed files.' }],
      why: ['The README is the first thing visitors and new contributors read.'], whyGood: ['No code changes; you learn the project while writing it.'],
      steps: ['Describe what the project does in two or three sentences.', 'Add setup and run instructions, checking each command yourself.', 'Outline the main folders.'],
      tests: ['Follow your own instructions on a fresh clone to check them.'],
    });
  } else if (rootReadme && rootReadme.lines > 0 && rootReadme.lines < 20) {
    push({
      id: `docs:expand:${rootReadme.path}`, title: 'Expand the README',
      summary: `${rootReadme.path} has only ${plural(rootReadme.lines, 'line')}. Setup steps and a folder overview would help new contributors.`,
      type: 'Documentation', tags: ['Documentation'], effort: 'Low', certainty: 'evidence',
      files: [{ path: rootReadme.path, role: `The README (${plural(rootReadme.lines, 'line')})`, main: true, exists: true }],
      evidence: [{ certainty: 'evidence', text: `${rootReadme.path} has ${plural(rootReadme.lines, 'line')}.` }],
      why: ['The README is the first thing visitors and new contributors read.'], whyGood: ['No code changes; you learn the project while writing it.'],
      steps: ['Read the current README and the manifest.', 'Add setup and run instructions, checking each command yourself.', 'Outline the main folders.'],
      tests: ['Follow your own instructions on a fresh clone to check them.'],
    });
  }
  if (!data.files.some((f) => /^contributing(\.[a-z]+)?$/i.test(f.name)) && data.files.length >= 20) {
    push({
      id: 'docs:contributing', title: 'Add contribution guidelines',
      summary: 'There is no CONTRIBUTING file. A short guide (how to set up, run tests and open a pull request) lowers the barrier for the next contributor.',
      type: 'Documentation', tags: ['Documentation', 'Community'], effort: 'Low', certainty: 'evidence',
      files: [{ path: 'CONTRIBUTING.md', role: 'Suggested new file (does not exist yet)', main: true, exists: false }, ...(rootReadme ? [{ path: rootReadme.path, role: 'Link to the new guide from here', exists: true }] : [])],
      evidence: [{ certainty: 'evidence', text: 'No file named CONTRIBUTING was found among the analysed files.' }],
      why: ['Clear guidelines save maintainers from repeating the same instructions.'], whyGood: ['You learn the workflow while documenting it.'],
      steps: ['Describe how to set up the project and run the tests.', 'Describe the expected pull request process (ask the maintainers if unsure).', 'Link it from the README.'],
      tests: ['Check every command you document.'],
    });
  }

  // ---- possibly unused modules (JS/TS only, heuristic) ----------------------------------------
  const unused = code.filter((f) => (JS_RE.test(f.name) || TS_RE.test(f.name)) && !/\.d\.[cm]?ts$/.test(f.name)
    && importedBy(f.path).length === 0 && f.exports.length > 0
    && !/^(main|index|app|server|cli|vite-env|setupTests|env)\b/i.test(f.name)
    && !/(^|\/)(pages|app|routes|api|scripts|bin|examples?|dev|stories|migrations|seeds?|public|sample|fixtures?)\//i.test(f.path)
    && !/\.(stories|config)\./i.test(f.name));
  for (const f of unused.sort((a, b) => b.lines - a.lines).slice(0, 3)) {
    push({
      id: `unused:${f.path}`,
      title: `Check whether ${f.name} is still used`,
      summary: `No analysed file imports ${f.name}, although it exports ${listNames(f.exports, 3)}. It may be unused, or loaded in a way the analysis cannot see (framework conventions, dynamic paths, external callers).`,
      type: 'Code Quality', tags: ['Cleanup'], effort: 'Low', certainty: 'heuristic',
      files: [{ path: f.path, role: `Not imported by any analysed file (${plural(f.lines, 'line')})`, main: true, exists: true }],
      evidence: [{ certainty: 'evidence', text: `0 analysed files import ${f.path}.` }, { certainty: 'heuristic', text: 'Files can also be loaded by configuration, by naming conventions or by code outside this repository.' }],
      why: ['Unused code costs reading time and maintenance.'], whyGood: ['A quick investigation that teaches how the project is wired.'],
      steps: [`Search the repository for "${f.name.replace(/\.[^.]+$/, '')}" and for ${listNames(f.exports.slice(0, 3).map((e) => `"${e}"`))}, including configuration files.`, 'If nothing uses it, open an issue or a pull request that removes it and explain how you checked.', 'If something does use it, consider documenting how.'],
      tests: ['Run the build and the test suite after removing anything.'],
    });
  }

  out.sort((a, b) => b.score - a.score || (a.title < b.title ? -1 : 1));
  return { list: out, limits };
}

/** Opportunities matching the type, effort and area filters (and only saved ones when asked). */
export function filterOpportunities(list: Opportunity[], f: { type: string; effort: string; area: string; savedOnly: boolean }, saved: ReadonlySet<string>): Opportunity[] {
  return list.filter((o) => (f.type === 'all' || o.type === f.type) && (f.effort === 'all' || o.effort === f.effort) && (f.area === 'all' || o.areas.includes(f.area)) && (!f.savedOnly || saved.has(o.id)));
}

/** "tests live in client/tests and are named *.test.ts" from the existing test files, or null */
export function describeTests(facts: RepoFacts): string | null {
  if (!facts.testFiles.length) return null;
  const dirs = new Map<string, number>();
  const suffixes = new Map<string, number>();
  for (const t of facts.testFiles) {
    dirs.set(t.folder, (dirs.get(t.folder) ?? 0) + 1);
    const m = /(\.(test|spec)\.[a-z]+|Tests?\.java|_test\.(py|go))$/i.exec(t.name) ?? (/^test_.*\.py$/i.test(t.name) ? ['test_*.py'] : null);
    if (m) suffixes.set(m[0].startsWith('test_') ? m[0] : `*${m[0]}`, (suffixes.get(m[0].startsWith('test_') ? m[0] : `*${m[0]}`) ?? 0) + 1);
  }
  const topDirs = [...dirs].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d || '(root)');
  const suffix = [...suffixes].sort((a, b) => b[1] - a[1])[0]?.[0];
  return `tests live in ${listNames(topDirs)}${suffix ? ` and are named ${suffix}` : ''}`;
}

/** A path for a new test of `f`, copied from the nearest existing test in the same area; null when that area has no tests. */
export function suggestTestPath(facts: RepoFacts, f: FileNode): { path: string; basedOn: string } | null {
  // Java/Maven keeps tests in src/test next to src/main: treat both as the same area
  const area = (p: string) => facts.areaOf(p.replace('/src/test/', '/src/main/').replace(/^src\/test\//, 'src/main/'));
  const near = (t: FileNode) => area(t.path) === area(f.path) || t.folder === '' || f.folder === t.folder || f.folder.startsWith(`${t.folder}/`);
  const pool = facts.testFiles.filter((t) => near(t) && /(\.(test|spec)\.[a-z]+|Tests?\.java|_test\.(py|go))$|^test_.*\.py$/i.test(t.name));
  if (!pool.length) return null;
  const shared = (t: FileNode) => { let i = 0; const a = t.path.split('/'), b = f.path.split('/'); while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const t = [...pool].sort((a, b) => shared(b) - shared(a) || (a.path < b.path ? -1 : 1))[0];
  const stemName = f.name.replace(/\.[^.]+$/, '');
  const ext = f.name.slice(f.name.lastIndexOf('.'));
  let fileName: string;
  const m = /\.(test|spec)\.[a-z]+$/i.exec(t.name);
  if (m) fileName = `${stemName}.${m[1]}${ext}`;
  else if (/Tests?\.java$/.test(t.name)) fileName = `${stemName}${/Tests\.java$/.test(t.name) ? 'Tests' : 'Test'}.java`;
  else if (/^test_.*\.py$/.test(t.name)) fileName = `test_${stemName}.py`;
  else if (/_test\.(py|go)$/.test(t.name)) fileName = `${stemName}_test${ext}`;
  else return null;
  // Java: mirror the package folder under src/test/java
  if (f.ext === '.java' && f.path.includes('/src/main/java/')) return { path: f.path.replace('/src/main/java/', '/src/test/java/').replace(/[^/]+$/, fileName), basedOn: t.path };
  const colocated = facts.data.files.some((x) => !facts.isTest(x.path) && x.folder === t.folder);
  return { path: `${colocated ? f.folder : t.folder}/${fileName}`.replace(/^\//, ''), basedOn: t.path };
}
