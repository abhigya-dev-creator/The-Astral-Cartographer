import type { IArchitecturalIssue } from '../../lib/api';

/**
 * Architectural findings in plain language, for people who do not know the jargon.
 * The analyzer's own wording (rule + description) is kept separately as "technical details".
 * Numbers are read from the analyzer's description text; if a format is not recognised the text stays general.
 */

export interface PlainFinding {
  /** short, plain headline, e.g. "These files depend on each other in a loop" */
  headline: string;
  /** one-line label for tooltips and badges */
  short: string;
  /** Serious / Worth fixing / Minor */
  level: string;
  /** what was found, in plain words */
  what: string;
  why: string;
  fix: string;
  /** how sure the analysis is */
  certainty: string;
  /** file names around a loop, when the finding is a circular dependency */
  loop?: string[];
}

export const LEVEL_LABEL: Record<IArchitecturalIssue['severity'], string> = { error: 'Serious', warning: 'Worth fixing', info: 'Minor' };

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function loopOf(description: string): string[] | undefined {
  const m = /:\s*(.+?\s->\s.+?)\.(\s|$)/.exec(description);
  if (!m) return undefined;
  return m[1].split(/\s->\s/).map((s) => (s === '…' ? '…' : base(s.trim())));
}

export function explainFinding(issue: IArchitecturalIssue): PlainFinding {
  const certainty = issue.confidence === 'confirmed'
    ? 'Certain: found directly in the import statements.'
    : 'Rule of thumb: based on a size or count limit, so use your judgement.';
  const level = LEVEL_LABEL[issue.severity] ?? 'Minor';
  const d = issue.description ?? '';

  switch (issue.type) {
    case 'circular_dependency': {
      const loop = loopOf(d);
      const members = (issue.affectedFiles ?? []).length;
      const ring = loop ? loop.join(' → ') : `${members || 'several'} files`;
      if (issue.severity === 'info') {
        return {
          headline: 'Files point to each other in a loop (only through types or lazy loading)',
          short: 'Loop between files (types or lazy loading only)',
          level, certainty, loop,
          what: `These files refer to each other in a circle: ${ring}. The loop only uses type imports or code that is loaded later, so it does not break the app when it starts.`,
          why: 'The files are still tied together: you cannot change, move or test one without the others.',
          fix: 'Move the shared types or code into a separate file that both can use, so the circle disappears.',
        };
      }
      return {
        headline: 'Files depend on each other in a loop',
        short: 'Loop: files depend on each other in a circle',
        level, certainty, loop,
        what: `These files import each other in a circle: ${ring}. Each one needs the next, and the last one needs the first again.`,
        why: 'When the app starts, one of these files can be used before it has finished loading. That causes confusing "undefined" errors, and none of the files can be changed or tested on its own.',
        fix: 'Find what the files share (often one function, constant or type) and move it into a new file that all of them import. Then the circle is broken.',
      };
    }
    case 'high_coupling': {
      const m = /imports (\d+) local modules and is imported by (\d+) modules/.exec(d);
      const uses = m ? Number(m[1]) : null;
      const usedBy = m ? Number(m[2]) : null;
      return {
        headline: 'This file is connected to too many other files',
        short: 'Too many connections to other files',
        level, certainty,
        what: m ? `It uses ${uses} other files of the project, and ${usedBy} files use it. That is more than the limit (12 used or 15 users).` : 'It uses, or is used by, more files than the recommended limit.',
        why: 'A small change here can break many other places, and it is hard to understand the file without reading all of its connections.',
        fix: 'Split it into smaller files with one clear job each, so every other file only depends on the part it needs.',
      };
    }
    case 'oversized_file': {
      const m = /\((\d+) lines, (?:(\d+) functions|function count unavailable)/.exec(d);
      const lines = m ? Number(m[1]) : null;
      const fns = m?.[2] ? Number(m[2]) : null;
      const sizeText = lines !== null ? `${lines.toLocaleString()} lines${fns !== null ? ` and ${fns} functions` : ''}` : 'very large';
      return {
        headline: 'This file is very large',
        short: 'Very large file',
        level, certainty,
        what: `It has ${sizeText}. The limit used is 500 lines or 25 functions.`,
        why: 'Big files usually do several different jobs at once. They are harder to read, review and test, and changes are more likely to break something unrelated.',
        fix: 'Group the code by what it does and move each group into its own smaller file.',
      };
    }
    case 'deep_import_nesting': {
      const m = /\("([^"]+)"\)/.exec(d);
      return {
        headline: 'This file reaches far away with a long relative path',
        short: 'Long "../../../" import path',
        level, certainty,
        what: m ? `It imports "${m[1]}", which climbs up three or more folders.` : 'It imports a file by climbing up three or more folders ("../../../").',
        why: 'Long paths like this break as soon as a folder is moved or renamed, and they make it hard to see where the code comes from.',
        fix: 'Set up a short path alias (for example "@/" for the src folder) and import through it.',
      };
    }
    default:
      return {
        headline: issue.rule || 'Architectural finding',
        short: issue.rule || 'Architectural finding',
        level, certainty,
        what: d,
        why: 'The analysis flagged this as a possible design problem.',
        fix: 'Read the details below and decide whether it needs a change.',
      };
  }
}

/** "1 serious problem, 2 worth fixing" for tooltips */
export function summarizeFindings(list: IArchitecturalIssue[]): string {
  const n = { error: 0, warning: 0, info: 0 };
  for (const i of list) n[i.severity] = (n[i.severity] ?? 0) + 1;
  const parts = [n.error && `${n.error} serious`, n.warning && `${n.warning} worth fixing`, n.info && `${n.info} minor`].filter(Boolean);
  return `${list.length} possible design problem${list.length === 1 ? '' : 's'} (${parts.join(', ')})`;
}
