import type { FileNode } from '../atlas/model';
import { listNames, plural, type RepoFacts } from './repoFacts';

/**
 * Beginner Path: an ordered learning queue built from the analysed repository.
 * Each step is chosen from evidence in the Dependency Atlas (file names, import graph, symbols) and every sentence
 * says what that evidence is. Nothing here reads file contents, so nothing claims what code does beyond the analysis.
 */

export type StepRole = 'readme' | 'manifest' | 'entry' | 'root' | 'routing' | 'state' | 'api' | 'shared' | 'domain' | 'config' | 'styles';

export interface LearningStep {
  path: string;
  role: StepRole;
  /** short label, e.g. "Entry point" */
  roleLabel: string;
  /** one-line description for the queue */
  summary: string;
  /** "What does this file do?" paragraphs (evidence-based) */
  what: string[];
  /** "Why is this important?" bullets */
  why: string[];
  /** "Key things to look for" bullets */
  lookFor: string[];
  importance: 'High' | 'Medium';
  /** the raw facts the step was chosen on */
  evidence: string[];
}

const ROLE_LABEL: Record<StepRole, string> = {
  readme: 'Project overview', manifest: 'Dependencies & scripts', entry: 'Entry point', root: 'Main module', routing: 'Routing',
  state: 'State & providers', api: 'API & services', shared: 'Shared module', domain: 'Domain model', config: 'Configuration', styles: 'Styling',
};

export const MAX_STEPS = 12;

const README_RE = /^readme(\.(md|markdown|rst|txt|adoc))?$/i;
const MANIFESTS: Record<string, string> = {
  'package.json': 'the npm package manifest: it lists the project\'s dependencies, its scripts (how to start, build and test it) and its package name',
  'pom.xml': 'the Maven build file: it declares dependencies, plugins and the Java version used to build the project',
  'build.gradle': 'the Gradle build script: it declares dependencies, plugins and build tasks',
  'build.gradle.kts': 'the Gradle build script (Kotlin DSL): it declares dependencies, plugins and build tasks',
  'requirements.txt': 'the list of Python packages the project needs',
  'pyproject.toml': 'the Python project definition: metadata, dependencies and tool settings',
  'setup.py': 'the Python package setup script',
  'go.mod': 'the Go module definition: module path and dependencies',
  'Cargo.toml': 'the Rust package manifest: dependencies and build settings',
  'composer.json': 'the PHP Composer manifest: dependencies and autoloading',
  'Gemfile': 'the Ruby dependency list',
};
const CONFIG_RE = /^(vite|webpack|rollup|next|nuxt|svelte|astro|babel|jest|vitest|tailwind|postcss|eslint)\.config\.[cm]?[jt]s$|^tsconfig\.json$|^application(-\w+)?\.(ya?ml|properties)$|^docker-compose\.ya?ml$|^Dockerfile$|^\.env\.example$|^angular\.json$/;
/** folder names that mark routing, state, API/service and domain code, in that order */
const ROLE_FOLDERS = [
  /^(routes?|routers?|routing|navigation)$/i,
  /^(stores?|contexts?|providers?|state|slices|redux)$/i,
  /^(api|apis|services?|clients?|http|gateways?|repositor(y|ies)|dao|controllers?)$/i,
  /^(models?|domain|entit(y|ies)|schemas?|types|dtos?)$/i,
];
const ENTRY_NAME_RE =/^(main|index|app|server|cli|bootstrap|program|manage|wsgi|asgi)$/i;

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

export function buildLearningPath(facts: RepoFacts): LearningStep[] {
  const { data, isTest, fanIn, imports, importedBy, name } = facts;
  const steps: LearningStep[] = [];
  const used = new Set<string>();
  const depth = (p: string) => p.split('/').length;
  const add = (s: Omit<LearningStep, 'roleLabel' | 'importance'> & { importance?: LearningStep['importance'] }) => {
    if (used.has(s.path) || steps.length >= MAX_STEPS) return;
    used.add(s.path);
    steps.push({ importance: 'Medium', ...s, roleLabel: ROLE_LABEL[s.role] });
  };
  const code = facts.codeFiles.filter((f) => !isTest(f.path));
  const byFanIn = (a: FileNode, b: FileNode) => fanIn(b.path) - fanIn(a.path) || depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : 1);
  const importersText = (p: string) => {
    const by = importedBy(p).filter((l) => !isTest(l.path)).map((l) => name(l.path));
    return by.length ? `Imported by ${plural(by.length, 'file')} (${listNames(by)}).` : 'No analysed file imports it.';
  };
  const symbols = (f: FileNode) => {
    const names = f.exports.filter((e) => e !== 'default').length ? f.exports.filter((e) => e !== 'default') : f.functions.filter((fn) => fn.kind !== 'method').map((fn) => fn.name);
    return [...new Set(names)];
  };

  // 1. README
  const readme = data.files.filter((f) => README_RE.test(f.name)).sort((a, b) => depth(a.path) - depth(b.path))[0];
  if (readme) {
    add({
      path: readme.path, role: 'readme', importance: 'High',
      summary: "Read the project's own description: purpose, setup and structure.",
      what: [`${readme.name} is the repository's README (${plural(readme.lines, 'line')}). A README is where maintainers usually describe what the project is for, how to set it up and how it is organised.`],
      why: ['It is written by the people who built the project, so it states their intent directly.', 'It usually has the setup steps you need before running anything.'],
      lookFor: ['What problem the project solves', 'How to install, configure and run it locally', 'How the repository is organised, and any contribution notes'],
      evidence: [`${readme.path} · ${plural(readme.lines, 'line')}`],
    });
  }

  // 2. dependency manifests (root first; in a multi-package repository, the shallowest ones)
  const manifests = data.files.filter((f) => MANIFESTS[f.name]).sort((a, b) => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : 1));
  const shallowest = manifests.length ? depth(manifests[0].path) : 0;
  for (const m of manifests.filter((f) => depth(f.path) === shallowest).slice(0, 2)) {
    const area = facts.areaOf(m.path);
    add({
      path: m.path, role: 'manifest', importance: 'High',
      summary: `Dependencies, scripts and build setup${area !== '(root)' ? ` of ${area}` : ''}.`,
      what: [`${m.name} is ${MANIFESTS[m.name]}.`],
      why: ['It tells you which libraries and frameworks the code builds on, so later files make more sense.', 'It shows the commands used to run, build and test the project.'],
      lookFor: ['The main frameworks and libraries', 'The commands for running and testing', 'Version requirements'],
      evidence: [m.path],
    });
  }

  // 3. entry points: imported by no other file, import local modules, and named like an entry point
  const entries = code
    .filter((f) => importedBy(f.path).filter((l) => !isTest(l.path)).length === 0 && imports(f.path).length > 0)
    .filter((f) => ENTRY_NAME_RE.test(stem(f.name)) || /Application\.java$/.test(f.name))
    .sort((a, b) => imports(b.path).length - imports(a.path).length || depth(a.path) - depth(b.path));
  const entryAreas = new Set<string>();
  const chosenEntries: FileNode[] = [];
  for (const e of entries) {
    const area = facts.areaOf(e.path);
    if (entryAreas.has(area) || chosenEntries.length >= 2) continue;
    entryAreas.add(area);
    chosenEntries.push(e);
  }
  for (const e of chosenEntries) {
    const deps = imports(e.path);
    add({
      path: e.path, role: 'entry', importance: 'High',
      summary: 'Where the application starts: no other file imports it.',
      what: [
        `No other analysed file imports ${e.name}, and it imports ${plural(deps.length, 'local module')} (${listNames(deps.map((d) => name(d.path)))}). Files with that pattern and this name are usually where a program starts.`,
        ...(symbols(e).length ? [`It declares ${listNames(symbols(e), 5)}.`] : []),
      ],
      why: ['Execution begins here, so reading it first shows the order in which everything else is set up.', 'Every import here is a module the application needs from the start.'],
      lookFor: [`What it does with ${name(deps[0].path)} (line ${deps[0].line})`, 'Which global setup happens here: configuration, providers, routes or a server starting', 'Where control passes next'],
      evidence: [`imported by 0 files`, `imports ${plural(deps.length, 'local module')}`],
    });

    // 4. right after each entry point, its main module: the local import with the most imports of its own
    const candidates = imports(e.path).map((l) => ({ ...l, out: imports(l.path).length })).filter((c) => c.out >= 2 && !isTest(c.path)).sort((a, b) => b.out - a.out);
    const c = candidates[0];
    const f = c && facts.file(c.path);
    if (!f) continue;
    add({
      path: f.path, role: 'root', importance: 'High',
      summary: `Imported by ${e.name}; it ties ${plural(c.out, 'module')} together.`,
      what: [`${e.name} imports this file (line ${c.line}). Of everything the entry point imports, it pulls in the most local modules (${plural(c.out, 'module')}: ${listNames(imports(f.path).map((l) => name(l.path)))}), so it is likely where the main parts are put together.`],
      why: ['It gives an overview of the application\'s main parts and how they connect.'],
      lookFor: ['How the imported modules are combined', ...(symbols(f).length ? [`The exported ${symbols(f).length === 1 ? 'symbol' : 'symbols'}: ${listNames(symbols(f), 4)}`] : []), 'Which parts are always present and which depend on conditions'],
      evidence: [`imported by ${e.path} (line ${c.line})`, `imports ${plural(c.out, 'local module')}`],
    });
  }

  // 5. routing and state, 6. API and services, 7. domain: matched by the parent folder's name or the end of the
  // file name, ranked by how many files use them
  // A folder match wins over a name match, and a file inside another role's folder (models/Repository.ts) is not
  // claimed by its name.
  const matchOf = (f: FileNode, folders: RegExp, suffix: RegExp) => {
    const parent = f.folder.slice(f.folder.lastIndexOf('/') + 1);
    if (folders.test(parent)) return `${parent}/`;
    if (ROLE_FOLDERS.some((re) => re.test(parent))) return null;
    return suffix.exec(stem(f.name))?.[0] ?? null;
  };
  const pick = (folders: RegExp, suffix: RegExp, role: StepRole, max: number, hint: string, lookFor: (f: FileNode) => string[], why: string[]) => {
    const byFolder = (f: FileNode) => (matchOf(f, folders, suffix)!.endsWith('/') ? 0 : 1);
    const found = code.filter((f) => matchOf(f, folders, suffix) && fanIn(f.path) >= 1 && !used.has(f.path)).sort((a, b) => byFolder(a) - byFolder(b) || byFanIn(a, b));
    const areas = new Set<string>();
    let n = 0;
    for (const f of found) {
      if (n >= max) break;
      const area = facts.areaOf(f.path);
      if (areas.has(area) && found.some((g) => !areas.has(facts.areaOf(g.path)) && !used.has(g.path))) continue; // prefer one per area
      areas.add(area);
      const match = matchOf(f, folders, suffix)!;
      const where = match.endsWith('/') ? 'folder' : 'name';
      add({
        path: f.path, role,
        summary: `${hint[0].toUpperCase()}${hint.slice(1)}; used by ${plural(fanIn(f.path), 'file')}.`,
        what: [`Its ${where} ("${match}") suggests ${hint}. ${importersText(f.path)}`, ...(symbols(f).length ? [`It declares ${listNames(symbols(f), 5)}.`] : [])],
        why, lookFor: lookFor(f),
        evidence: [`${where} "${match}"`, `imported by ${plural(fanIn(f.path), 'non-test file')}`],
      });
      n++;
    }
  };
  pick(ROLE_FOLDERS[0], /(routes?|router|routing)$/i, 'routing', 1, 'it defines routes or navigation',
    () => ['Which paths or URLs exist', 'Which module handles each route', 'Any checks that run before a route (authentication, guards)'],
    ['Routes map what a user or client asks for to the code that answers it.']);
  pick(ROLE_FOLDERS[1], /(store|context|provider|slice)$/i, 'state', 1, 'it holds shared state or providers',
    () => ['What state is kept and who changes it', 'How components or modules read it', 'Default values'],
    ['Shared state explains how separate parts of the application stay in sync.']);
  pick(ROLE_FOLDERS[2], /(api|service|client|http|gateway|repository|dao|controller)$/i, 'api', 2, 'it handles communication or service logic',
    (f) => [...(symbols(f).length ? [`The functions it offers: ${listNames(symbols(f), 4)}`] : []), 'How requests are made and errors are handled', 'Which modules depend on it'],
    ['Many features go through this layer, so understanding it explains how data moves.']);

  // 8. shared modules: the most widely imported remaining files
  for (const f of code.filter((x) => !used.has(x.path) && fanIn(x.path) >= 2).sort(byFanIn).slice(0, 1)) {
    const isComponent = /(^|\/)(components?|ui|widgets?)\//i.test(f.path);
    const more = code.filter((x) => fanIn(x.path) > fanIn(f.path)).length;
    add({
      path: f.path, role: 'shared',
      summary: `${isComponent ? 'Shared component' : 'Widely used module'}: imported by ${plural(fanIn(f.path), 'file')}.`,
      what: [`${importersText(f.path)} ${more === 0 ? 'No other file in the repository is imported more often.' : `Only ${plural(more, 'other file')} ${more === 1 ? 'is' : 'are'} imported more often.`}`, ...(symbols(f).length ? [`It declares ${listNames(symbols(f), 5)}.`] : [])],
      why: ['A change here affects every file that imports it, so it is worth knowing well.'],
      lookFor: [...(symbols(f).length ? [`What ${listNames(symbols(f), 3)} ${symbols(f).length === 1 ? 'does' : 'do'}`] : []), 'Which inputs it expects and what it returns', 'How the importing files use it'],
      evidence: [`imported by ${plural(fanIn(f.path), 'non-test file')}`],
    });
  }

  pick(ROLE_FOLDERS[3], /(model|entity|schema|types|dto)$/i, 'domain', 1, 'it defines domain models or shared types',
    (f) => [...(symbols(f).length ? [`The types or models it declares: ${listNames(symbols(f), 4)}`] : []), 'Which fields are required', 'Where these models are created and used'],
    ['Models and types are the vocabulary the rest of the code uses.']);

  // 9. configuration and styles
  const configs = data.files.filter((f) => CONFIG_RE.test(f.name)).sort((a, b) => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : 1));
  for (const f of configs.slice(0, 1)) {
    add({
      path: f.path, role: 'config',
      summary: 'Build or runtime configuration.',
      what: [`${f.name} is a configuration file (${plural(f.lines, 'line')}). Its name follows the convention of ${configKind(f.name)}.`],
      why: ['Configuration explains behaviour that is not visible in the source: ports, paths, build options and environment settings.'],
      lookFor: ['Settings that differ between development and production', 'Paths, aliases or ports that other files rely on', 'Values that come from environment variables'],
      evidence: [f.path],
    });
  }
  const styles = data.files.filter((f) => /\.(css|scss|sass|less)$/i.test(f.name)).sort((a, b) => importedBy(b.path).length - importedBy(a.path).length || depth(a.path) - depth(b.path));
  const style = styles.find((f) => importedBy(f.path).length > 0 || /^(global|globals|index|main|app|styles?)\./i.test(f.name));
  if (style) {
    const by = importedBy(style.path);
    add({
      path: style.path, role: 'styles',
      summary: 'Styles shared across the interface.',
      what: [by.length ? `This stylesheet is imported by ${listNames(by.map((l) => name(l.path)))}.` : `Its name (${style.name}) is a common name for global styles.`],
      why: ['Global styles and design tokens explain how the interface looks everywhere.'],
      lookFor: ['Colour, spacing and typography variables', 'Layout rules shared by many components', 'Naming conventions for classes'],
      evidence: [by.length ? `imported by ${plural(by.length, 'file')}` : 'name only'],
    });
  }

  // too little structure found (e.g. a repository the analyzer reads no imports for): fall back to the largest code files
  if (steps.length < 3) {
    for (const f of code.filter((x) => !used.has(x.path)).sort((a, b) => b.lines - a.lines).slice(0, 5 - steps.length)) {
      add({
        path: f.path, role: 'shared',
        summary: `One of the largest source files (${plural(f.lines, 'line')}).`,
        what: [`The analysis found no import relationships to rank files by, so this step is chosen by size: ${f.name} has ${plural(f.lines, 'line')}.`],
        why: ['Large files often hold a lot of the core logic.'],
        lookFor: ['What its main functions or classes are', 'Which other files it seems to rely on'],
        evidence: [`${plural(f.lines, 'line')}`],
      });
    }
  }
  return steps;
}

function configKind(name: string): string {
  if (/^tsconfig/.test(name)) return 'the TypeScript compiler settings';
  if (/^application/.test(name)) return 'Spring application settings';
  if (/^docker-compose|^Dockerfile/.test(name)) return 'container setup';
  if (/^\.env\.example$/.test(name)) return 'an example of the environment variables the project expects';
  return `${name.split('.')[0]} tool settings`;
}

/** Why `next` follows `cur`, from the import graph when it connects them. */
export function nextStepReason(facts: RepoFacts, cur: LearningStep, next: LearningStep): string {
  const fwd = facts.imports(cur.path).find((l) => l.path === next.path);
  if (fwd) return `${facts.name(cur.path)} imports ${facts.name(next.path)} (line ${fwd.line}), so it continues the path you just followed.`;
  const back = facts.imports(next.path).find((l) => l.path === cur.path);
  if (back) return `${facts.name(next.path)} imports the file you just read (line ${back.line}), so you will recognise what it builds on.`;
  const TRANSITION: Partial<Record<StepRole, string>> = {
    manifest: 'Now that you know what the project is, see what it is built with.',
    entry: 'With the setup in mind, go to where the application starts running.',
    root: 'Next is the module that puts the main parts together.',
    routing: 'Next, see how requests or pages are routed to the code that handles them.',
    state: 'Next, see where shared state lives.',
    api: 'Next, look at how the application talks to other services and data.',
    shared: 'Next is a module many other files depend on.',
    domain: 'Next, look at the models and types the code is built around.',
    config: 'Next, see the configuration that shapes how the project builds and runs.',
    styles: 'Finally, see the styles shared across the interface.',
  };
  return TRANSITION[next.role] ?? `Next: ${next.roleLabel.toLowerCase()}.`;
}
