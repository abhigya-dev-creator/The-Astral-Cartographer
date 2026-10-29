import type { LearningStep } from './learningPath';
import type { Opportunity } from './opportunities';
import { languageOfFile, listNames, plural, type RepoFacts } from './repoFacts';

/**
 * Companion answers built from the repository analysis only. No AI model is connected to this application, so the
 * companion never writes free-form explanations: it answers questions the analysis can answer and says plainly when a
 * question needs an AI model (reading and interpreting the code itself).
 */

export interface AnswerLink { label: string; path: string; line?: number }
export interface Answer {
  title?: string;
  paragraphs: string[];
  bullets?: string[];
  links?: AnswerLink[];
  /** 'analysis' = facts from the analysis; 'limit' = the question needs something that is not available */
  kind: 'analysis' | 'limit' | 'ai';
  /** AI answers: the raw text (Markdown) and the files the AI was given */
  text?: string;
  usedFiles?: string[];
}
export interface ChatMessage { id: number; role: 'user' | 'companion'; text?: string; answer?: Answer }
export interface Suggestion { id: string; label: string }

export const AI_NOT_CONNECTED = 'No AI model is connected to this application, so the companion answers only from the repository analysis.';

// ---- Beginner Path ------------------------------------------------------------------------------

export function beginnerSuggestions(step: LearningStep | null, path: string | null): Suggestion[] {
  const out: Suggestion[] = [];
  if (path) out.push({ id: 'explain-file', label: 'Explain this file' });
  if (step?.role === 'entry') out.push({ id: 'why-entry', label: 'Why is this the entry point?' });
  out.push({ id: 'main-parts', label: 'What are the main components?' });
  if (path) out.push({ id: 'dependents', label: 'What depends on this file?' }, { id: 'imports', label: 'What does this file import?' });
  out.push({ id: 'entry-points', label: 'Where does the application start?' });
  return out;
}

export function answerBeginner(q: { id?: string; text?: string }, facts: RepoFacts, path: string | null, steps: LearningStep[]): Answer {
  const id = q.id ?? intentOf(q.text ?? '', facts, path);
  const target = q.text ? mentionedFile(q.text, facts) ?? path : path;
  const step = steps.find((s) => s.path === target) ?? null;
  switch (id) {
    case 'explain-file': return target ? explainFile(facts, target, step) : needFile();
    case 'why-entry': return whyEntry(facts, target, step);
    case 'dependents': return target ? dependents(facts, target) : needFile();
    case 'imports': return target ? importsOf(facts, target) : needFile();
    case 'main-parts': return mainParts(facts);
    case 'entry-points': return entryPoints(facts, steps);
    default: return unknown(q.text ?? '', target ? facts.name(target) : null);
  }
}

// ---- Contributor Path ---------------------------------------------------------------------------

export function contributorSuggestions(o: Opportunity | null): Suggestion[] {
  if (!o) return [{ id: 'best-first', label: 'Which opportunity should I start with?' }];
  const s: Suggestion[] = [{ id: 'changes', label: 'What changes are needed?' }, { id: 'files', label: 'Which files are involved?' }];
  s.push({ id: 'tests', label: o.type === 'Testing' ? 'How should I write these tests?' : 'Which tests should I run or add?' });
  s.push({ id: 'evidence', label: 'What is the evidence?' });
  if (o.related.length) s.push({ id: 'related', label: `Show related findings (${o.related.length})` });
  const main = o.files.find((f) => f.main && f.exists);
  if (main) s.push({ id: 'explain-main', label: `Explain ${main.path.slice(main.path.lastIndexOf('/') + 1)}` });
  return s;
}

export function answerContributor(q: { id?: string; text?: string }, facts: RepoFacts, o: Opportunity | null, all: Opportunity[]): Answer {
  const t = (q.text ?? '').toLowerCase();
  const id = q.id ?? (
    /start|first|easiest|begin|recommend/.test(t) ? 'best-first'
      : /test/.test(t) ? 'tests'
        : /file|where/.test(t) ? 'files'
          : /evidence|why|proof|sure|confirm/.test(t) ? 'evidence'
            : /finding|issue|related/.test(t) ? 'related'
              : /change|fix|how|plan|approach|step/.test(t) ? 'changes'
                : mentionedFile(t, facts) ? 'explain-mentioned' : 'unknown');
  if (id === 'best-first') {
    const good = all.filter((x) => x.goodFirst).slice(0, 3);
    const pickFrom = good.length ? good : all.slice(0, 3);
    if (!pickFrom.length) return { kind: 'analysis', paragraphs: ['The analysis did not produce any contribution opportunities for this repository.'] };
    return {
      kind: 'analysis', title: good.length ? 'Good first opportunities' : 'Highest-ranked opportunities',
      paragraphs: [good.length ? 'These are small (low estimated effort), touch few files and rest on analysis evidence rather than heuristics:' : 'None qualifies as a good first issue (low effort, few files, backed by evidence). These rank highest:'],
      bullets: pickFrom.map((x) => `${x.title}: ${x.effort.toLowerCase()} estimated effort, ${plural(x.files.filter((f) => f.exists).length, 'file')}.`),
    };
  }
  if (id === 'explain-mentioned') {
    const p = mentionedFile(t, facts)!;
    return explainFile(facts, p, null);
  }
  if (!o) return { kind: 'analysis', paragraphs: ['Select an opportunity on the left first, then ask about it.'] };
  switch (id) {
    case 'changes': return { kind: 'analysis', title: 'Suggested approach', paragraphs: ['This outline is a suggestion based on the evidence, not a verified plan. Check each step against the code.'], bullets: o.steps };
    case 'files': return {
      kind: 'analysis', title: 'Files involved',
      paragraphs: [`${plural(o.files.filter((f) => f.exists).length, 'existing file')}${o.files.some((f) => !f.exists) ? ', plus suggested new files' : ''}:`],
      bullets: o.files.map((f) => `${f.path}: ${f.role}`),
      links: o.files.filter((f) => f.exists).map((f) => ({ label: facts.name(f.path), path: f.path, line: f.line })),
    };
    case 'tests': return { kind: 'analysis', title: 'Testing', paragraphs: o.tests };
    case 'evidence': return {
      kind: 'analysis', title: 'Evidence',
      paragraphs: [o.certainty === 'confirmed' ? 'This is a confirmed finding of the analysis.' : o.certainty === 'evidence' ? 'This is based on facts the analysis recorded.' : 'This rests on a heuristic (a threshold or naming pattern). Verify it before you start.'],
      bullets: o.evidence.map((e) => e.text),
    };
    case 'related': return o.related.length
      ? { kind: 'analysis', title: 'Related architectural findings', paragraphs: ['Findings of the analysis that touch the same files:'], bullets: o.related.map((i) => `${i.severity.toUpperCase()} · ${i.rule}: ${i.description}`) }
      : { kind: 'analysis', paragraphs: ['No other architectural findings touch these files.'] };
    case 'explain-main': {
      const main = o.files.find((f) => f.main && f.exists);
      return main ? explainFile(facts, main.path, null) : needFile();
    }
    default: return unknown(q.text ?? '', null);
  }
}

// ---- shared answers -----------------------------------------------------------------------------

export function explainFile(facts: RepoFacts, path: string, step: LearningStep | null): Answer {
  const f = facts.file(path);
  if (!f) return { kind: 'analysis', paragraphs: [`${path} is not among the analysed files.`] };
  const imports = facts.imports(path);
  const by = facts.importedBy(path);
  const pkgs = facts.packages(path);
  const decl = f.functions.filter((x) => x.kind !== 'method');
  const paragraphs = [
    `${f.name} is a ${languageOfFile(f)} file with ${plural(f.lines, 'line')} in ${f.folder || 'the repository root'}.`,
    ...(step ? step.what : []),
  ];
  const bullets = [
    imports.length ? `Imports ${plural(imports.length, 'local file')}: ${listNames(imports.map((l) => facts.name(l.path)), 5)}.` : 'Imports no local files.',
    by.length ? `Imported by ${plural(by.length, 'file')}: ${listNames(by.map((l) => facts.name(l.path)), 5)}.` : 'No analysed file imports it.',
    ...(pkgs.length ? [`Uses ${plural(pkgs.length, 'external package')}: ${listNames(pkgs, 5)}.`] : []),
    ...(decl.length ? [`Declares ${listNames(decl.map((x) => `${x.name} (line ${x.line})`), 6)}.`] : []),
    ...(f.exports.length ? [`Exports ${listNames(f.exports, 6)}.`] : []),
    ...(facts.model.cycleOf.has(path) ? ['It is part of a circular dependency.'] : []),
  ];
  return {
    kind: 'analysis', title: f.name, paragraphs, bullets,
    links: [...imports.slice(0, 3), ...by.slice(0, 3)].map((l) => ({ label: facts.name(l.path), path: l.path, line: l.line })),
  };
}

function whyEntry(facts: RepoFacts, path: string | null, step: LearningStep | null): Answer {
  if (!path || step?.role !== 'entry') return { kind: 'analysis', paragraphs: ['The current file was not identified as an entry point. Ask "Where does the application start?" to see the files that were.'] };
  const imports = facts.imports(path);
  return {
    kind: 'analysis', title: `Why ${facts.name(path)} looks like an entry point`,
    paragraphs: ['The analysis cannot run the program, so this is an inference from two facts:'],
    bullets: [
      'No other analysed file imports it, so nothing else loads it: something outside the code (a script, the browser, a runtime) must start it.',
      `It imports ${plural(imports.length, 'local module')} (${listNames(imports.map((l) => facts.name(l.path)), 4)}), so it sets other parts in motion.`,
      `Its name, ${facts.name(path)}, is a common name for an entry point.`,
    ],
    links: imports.slice(0, 4).map((l) => ({ label: facts.name(l.path), path: l.path, line: l.line })),
  };
}

function dependents(facts: RepoFacts, path: string): Answer {
  const by = facts.importedBy(path);
  if (!by.length) return { kind: 'analysis', paragraphs: [`No analysed file imports ${facts.name(path)}.`] };
  return {
    kind: 'analysis', title: `Files that import ${facts.name(path)}`,
    paragraphs: [`${plural(by.length, 'file')} import it${by.some((l) => facts.isTest(l.path)) ? ' (tests included)' : ''}:`],
    bullets: by.slice(0, 15).map((l) => `${l.path} (line ${l.line})${facts.isTest(l.path) ? ' · test' : ''}`),
    links: by.slice(0, 6).map((l) => ({ label: facts.name(l.path), path: l.path, line: l.line })),
  };
}

function importsOf(facts: RepoFacts, path: string): Answer {
  const imports = facts.imports(path);
  const pkgs = facts.packages(path);
  if (!imports.length && !pkgs.length) return { kind: 'analysis', paragraphs: [`The analysis found no imports in ${facts.name(path)}.`] };
  return {
    kind: 'analysis', title: `What ${facts.name(path)} imports`,
    paragraphs: [],
    bullets: [...imports.map((l) => `${l.path} (line ${l.line})`), ...(pkgs.length ? [`External: ${listNames(pkgs, 8)}`] : [])],
    links: imports.slice(0, 6).map((l) => ({ label: facts.name(l.path), path: l.path, line: l.line })),
  };
}

function mainParts(facts: RepoFacts): Answer {
  const areas = new Map<string, number>();
  for (const f of facts.data.files) areas.set(facts.areaOf(f.path), (areas.get(facts.areaOf(f.path)) ?? 0) + 1);
  const top = [...facts.codeFiles].filter((f) => !facts.isTest(f.path)).sort((a, b) => facts.fanIn(b.path) - facts.fanIn(a.path)).slice(0, 6).filter((f) => facts.fanIn(f.path) > 0);
  return {
    kind: 'analysis', title: 'Main parts of the repository',
    paragraphs: [`The repository has ${plural(facts.data.files.length, 'analysed file')}. Top-level areas:`],
    bullets: [
      ...[...areas].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, n]) => `${a}: ${plural(n, 'file')}`),
      ...(top.length ? [`Most imported modules: ${listNames(top.map((f) => `${f.name} (${facts.fanIn(f.path)})`), 6)}`] : []),
    ],
    links: top.map((f) => ({ label: f.name, path: f.path })),
  };
}

function entryPoints(facts: RepoFacts, steps: LearningStep[]): Answer {
  const entries = steps.filter((s) => s.role === 'entry');
  if (!entries.length) return { kind: 'analysis', paragraphs: ['The analysis found no file that looks like an entry point: no file that nothing imports, that imports other modules and has a typical entry-point name.'] };
  return {
    kind: 'analysis', title: 'Where the application starts',
    paragraphs: ['These files are imported by no other file, import local modules and have typical entry-point names:'],
    bullets: entries.map((s) => `${s.path}: imports ${plural(facts.imports(s.path).length, 'local module')}`),
    links: entries.map((s) => ({ label: facts.name(s.path), path: s.path })),
  };
}

const needFile = (): Answer => ({ kind: 'analysis', paragraphs: ['Select a file first, or name one in your question.'] });

function unknown(text: string, fileName: string | null): Answer {
  return {
    kind: 'limit',
    paragraphs: [
      `${AI_NOT_CONNECTED} ${text ? 'This question needs someone (or an AI model) to read and interpret the code, which the analysis cannot do.' : ''}`.trim(),
      `You can ask about files by name, about what a file imports or what depends on it, where the application starts, or the main parts of the repository${fileName ? `, or open the Code Preview of ${fileName} and read it directly` : ''}.`,
    ],
  };
}

function intentOf(text: string, facts: RepoFacts, path: string | null): string {
  const t = text.toLowerCase();
  if (/entry|start|begin|main file|bootstrap/.test(t) && /why/.test(t)) return 'why-entry';
  if (/where.*(start|begin)|entry point/.test(t)) return 'entry-points';
  if (/depend(s|ents)? on|import(s|ed)? (it|this)|who uses|used by|imported by/.test(t)) return 'dependents';
  if (/what does .* import|imports of|dependencies of|what .* import/.test(t)) return 'imports';
  if (/main (parts|components|modules)|structure|architecture|overview|organi[sz]ed/.test(t)) return 'main-parts';
  if (/explain|what (is|does)|tell me about|describe/.test(t) && (mentionedFile(t, facts) || path)) return 'explain-file';
  if (mentionedFile(t, facts)) return 'explain-file';
  return 'unknown';
}

/** A repository file named in the text (full name with extension, or a distinctive stem), or null. */
export function mentionedFile(text: string, facts: RepoFacts): string | null {
  const t = text.toLowerCase();
  const words = new Set(t.split(/[^a-z0-9_.$/-]+/).filter((w) => w.length >= 3));
  let best: string | null = null;
  for (const f of facts.data.files) {
    const n = f.name.toLowerCase();
    const stemName = n.replace(/\.[^.]+$/, '');
    if (words.has(n) || words.has(f.path.toLowerCase()) || (stemName.length >= 4 && words.has(stemName))) {
      if (!best || f.path.length < best.length) best = f.path;
    }
  }
  return best;
}
