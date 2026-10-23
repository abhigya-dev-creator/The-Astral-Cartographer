import crypto from 'crypto';
import type { AnalyzedFile, ArchitecturalIssue, DependencyEdge, RuleRun } from './types.js';

export const THRESHOLDS = {
  MAX_FAN_OUT: 12,
  MAX_FAN_IN: 15,
  MAX_LINES: 500,
  MAX_FUNCTIONS: 25,
  DEEP_IMPORT_LEVELS: 3,
  /** only this many member files are listed in a finding (the full count is in the description) */
  MAX_LISTED_FILES: 50,
};

export interface ArchInput {
  file: AnalyzedFile;
  /** every import occurrence with a static specifier (for line numbers) */
  imports: Array<{ specifier: string; line: number }>;
}

const EAGER = new Set(['static', 'reexport']);
const issueId = (...parts: Array<string | number | undefined>) =>
  crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

// ---------------------------------------------------------------------------------------------
// Tarjan strongly-connected components (iterative – safe on very deep import chains)
// ---------------------------------------------------------------------------------------------
export function stronglyConnected(nodes: string[], adj: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ v: string; i: number }> = [{ v: root, i: 0 }];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];
      const nbrs = adj.get(frame.v) || [];
      if (frame.i < nbrs.length) {
        const w = nbrs[frame.i++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++;
          stack.push(w); onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
      } else {
        if (low.get(frame.v) === index.get(frame.v)) {
          const comp: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== frame.v);
          result.push(comp);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
        }
      }
    }
  }
  return result;
}

/** Shortest path from `start` back to `start` staying inside `members`. */
function shortestCycle(start: string, members: Set<string>, adj: Map<string, string[]>): string[] {
  const prev = new Map<string, string>();
  const queue: string[] = [];
  for (const n of adj.get(start) || []) {
    if (!members.has(n)) continue;
    if (n === start) return [start, start];
    if (!prev.has(n)) { prev.set(n, start); queue.push(n); }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (const n of adj.get(v) || []) {
      if (!members.has(n)) continue;
      if (n === start) {
        const path = [start];
        const chain: string[] = [];
        for (let c = v; c !== start; c = prev.get(c)!) chain.push(c);
        return path.concat(chain.reverse(), [start]);
      }
      if (!prev.has(n)) { prev.set(n, v); queue.push(n); }
    }
  }
  return [start];
}

export function runArchitecturalRules(
  inputs: ArchInput[],
  edges: DependencyEdge[]
): { issues: ArchitecturalIssue[]; rules: RuleRun[] } {
  const issues: ArchitecturalIssue[] = [];
  const rules: RuleRun[] = [];
  const byPath = new Map(inputs.map((i) => [i.file.path, i.file]));

  const jsEligible = inputs.map((i) => i.file); // caller passes only full-support (JS/TS) files
  const importsKnown = (f: AnalyzedFile) => f.parseStatus !== 'skipped_large' && f.parseStatus !== 'skipped_timeout' && f.parseStatus !== 'unreadable';
  const skipTally = (pred: (f: AnalyzedFile) => string | null) => {
    const t: Record<string, number> = {};
    for (const f of jsEligible) { const r = pred(f); if (r) t[r] = (t[r] || 0) + 1; }
    return t;
  };

  const internal = edges.filter((e) => e.type === 'internal' && byPath.has(e.source) && byPath.has(e.target));

  // ---- 1. circular dependencies (deterministic) --------------------------------------------
  {
    const nodes = jsEligible.map((f) => f.path).sort();
    const mk = (pred: (e: DependencyEdge) => boolean) => {
      const adj = new Map<string, string[]>();
      for (const e of internal) if (pred(e)) { if (!adj.has(e.source)) adj.set(e.source, []); adj.get(e.source)!.push(e.target); }
      for (const [k, v] of adj) adj.set(k, [...new Set(v)].sort());
      return adj;
    };
    const eagerAdj = mk((e) => EAGER.has(e.kind));
    const allAdj = mk(() => true);
    const cyclic = (comp: string[], adj: Map<string, string[]>) =>
      comp.length > 1 || (adj.get(comp[0]) || []).includes(comp[0]);

    const eagerSccs = stronglyConnected(nodes, eagerAdj).filter((c) => cyclic(c, eagerAdj));
    const allSccs = stronglyConnected(nodes, allAdj).filter((c) => cyclic(c, allAdj));
    const eagerKeys = new Set(eagerSccs.map((c) => [...c].sort().join('|')));

    const emit = (comp: string[], adj: Map<string, string[]>, eager: boolean) => {
      const sorted = [...comp].sort();
      const members = new Set(sorted);
      const first = sorted[0];
      const cycle = shortestCycle(first, members, adj);
      const lineEdge = internal.find((e) => e.source === cycle[0] && e.target === cycle[1]);
      const shown = cycle.length > 12 ? [...cycle.slice(0, 11), '…', cycle[cycle.length - 1]] : cycle;
      const extra = sorted.length > cycle.length - 1 ? ` The cycle belongs to a tangled group of ${sorted.length} mutually dependent files.` : '';
      issues.push({
        id: issueId('circular_dependency', eager ? 'eager' : 'lazy', sorted.join(',')),
        type: 'circular_dependency',
        severity: eager ? 'error' : 'info',
        confidence: 'confirmed',
        file: first,
        line: lineEdge?.line || undefined,
        affectedFiles: sorted.slice(0, THRESHOLDS.MAX_LISTED_FILES),
        description: eager
          ? `Circular dependency detected: ${shown.join(' -> ')}.${extra}`
          : `Circular dependency that exists only through dynamic import() or type-only imports (not at module load time): ${shown.join(' -> ')}.${extra}`,
        rule: 'No Circular Dependencies',
      });
    };
    for (const c of eagerSccs) emit(c, eagerAdj, true);
    for (const c of allSccs) if (!eagerKeys.has([...c].sort().join('|'))) emit(c, allAdj, false);

    rules.push({
      type: 'circular_dependency',
      rule: 'No Circular Dependencies',
      confidence: 'confirmed',
      basis: 'Strongly-connected components of the resolved local import graph. Deterministic given correct import resolution.',
      eligibleFiles: jsEligible.length,
      incompleteFiles: jsEligible.filter((f) => !importsKnown(f)).length,
      skipped: skipTally((f) => (importsKnown(f) ? null : 'imports not analysed')),
      findings: issues.filter((i) => i.type === 'circular_dependency').length,
    });
  }

  // ---- 2. high coupling (heuristic) ---------------------------------------------------------
  {
    const fanOut = new Map<string, Set<string>>();
    const fanIn = new Map<string, Set<string>>();
    for (const e of internal) {
      const src = byPath.get(e.source)!;
      if (e.kind !== 'reexport') {
        if (!fanOut.has(e.source)) fanOut.set(e.source, new Set());
        fanOut.get(e.source)!.add(e.target);
      }
      if (!src.isTest) {
        if (!fanIn.has(e.target)) fanIn.set(e.target, new Set());
        fanIn.get(e.target)!.add(e.source);
      }
    }
    const before = issues.length;
    let eligible = 0;
    for (const f of jsEligible) {
      if (f.isTest || f.isGenerated || f.isDeclaration) continue;
      eligible++;
      const out = fanOut.get(f.path)?.size ?? 0;
      const inn = fanIn.get(f.path)?.size ?? 0;
      if (out > THRESHOLDS.MAX_FAN_OUT || inn > THRESHOLDS.MAX_FAN_IN) {
        issues.push({
          id: issueId('high_coupling', f.path),
          type: 'high_coupling',
          severity: 'warning',
          confidence: 'heuristic',
          file: f.path,
          affectedFiles: [f.path],
          description: `Hub module with high coupling: imports ${out} local modules and is imported by ${inn} modules (thresholds: more than ${THRESHOLDS.MAX_FAN_OUT} imports or ${THRESHOLDS.MAX_FAN_IN} importers). Consider decoupling dependencies.`,
          rule: 'Decoupled Architecture',
        });
      }
    }
    rules.push({
      type: 'high_coupling',
      rule: 'Decoupled Architecture',
      confidence: 'heuristic',
      basis: `Counts distinct local imports (excluding pure re-exports) and distinct non-test importers; flags > ${THRESHOLDS.MAX_FAN_OUT} / > ${THRESHOLDS.MAX_FAN_IN}. Thresholds are conventions, and legitimate hubs (entry points, shared utils) can trigger it.`,
      eligibleFiles: eligible,
      incompleteFiles: jsEligible.filter((f) => !importsKnown(f)).length,
      skipped: skipTally((f) => (f.isTest ? 'test file' : f.isGenerated ? 'generated file' : f.isDeclaration ? 'type declaration (.d.ts)' : null)),
      findings: issues.length - before,
    });
  }

  // ---- 3. oversized files (heuristic) -------------------------------------------------------
  {
    const before = issues.length;
    let eligible = 0;
    for (const f of jsEligible) {
      if (f.isTest || f.isGenerated || f.isDeclaration || f.parseStatus === 'skipped_timeout' || f.parseStatus === 'unreadable') continue;
      eligible++;
      const fns = f.functionCount;
      if (f.lineCount > THRESHOLDS.MAX_LINES || (fns ?? 0) > THRESHOLDS.MAX_FUNCTIONS) {
        issues.push({
          id: issueId('oversized_file', f.path),
          type: 'oversized_file',
          severity: 'warning',
          confidence: 'heuristic',
          file: f.path,
          line: 1,
          affectedFiles: [f.path],
          description: `Module exceeds recommended size (${f.lineCount} lines, ${fns === null ? 'function count unavailable' : `${fns} functions`}; thresholds: ${THRESHOLDS.MAX_LINES} lines or ${THRESHOLDS.MAX_FUNCTIONS} functions). Consider breaking into smaller modules.`,
          rule: 'Single Responsibility Principle',
        });
      }
    }
    rules.push({
      type: 'oversized_file',
      rule: 'Single Responsibility Principle',
      confidence: 'heuristic',
      basis: `Flags source files with more than ${THRESHOLDS.MAX_LINES} lines or ${THRESHOLDS.MAX_FUNCTIONS} functions. Size is a proxy, not proof, of low cohesion.`,
      eligibleFiles: eligible,
      incompleteFiles: jsEligible.filter((f) => f.parseStatus === 'skipped_large' || f.parseStatus === 'fallback').length,
      skipped: skipTally((f) => (f.isTest ? 'test file' : f.isGenerated ? 'generated file' : f.isDeclaration ? 'type declaration (.d.ts)' : f.parseStatus === 'skipped_timeout' ? 'time budget exhausted' : null)),
      findings: issues.length - before,
    });
  }

  // ---- 4. deep relative imports (heuristic) -------------------------------------------------
  {
    const before = issues.length;
    const re = new RegExp(`^(?:\\.\\./){${THRESHOLDS.DEEP_IMPORT_LEVELS},}`);
    let eligible = 0;
    for (const { file, imports } of inputs) {
      if (!importsKnown(file) || file.isGenerated) continue;
      eligible++;
      const seen = new Set<string>();
      for (const imp of imports) {
        if (!re.test(imp.specifier) || seen.has(imp.specifier)) continue;
        seen.add(imp.specifier);
        issues.push({
          id: issueId('deep_import_nesting', file.path, imp.specifier),
          type: 'deep_import_nesting',
          severity: 'info',
          confidence: 'heuristic',
          file: file.path,
          line: imp.line || undefined,
          affectedFiles: [file.path],
          description: `Deep relative import path ("${imp.specifier}"). Consider configuring module path aliases for cleaner architecture.`,
          rule: 'Clean Module Hierarchy',
        });
      }
    }
    rules.push({
      type: 'deep_import_nesting',
      rule: 'Clean Module Hierarchy',
      confidence: 'heuristic',
      basis: `Flags relative imports that climb ${THRESHOLDS.DEEP_IMPORT_LEVELS}+ directories ("../" × ${THRESHOLDS.DEEP_IMPORT_LEVELS}). Reported once per file and specifier.`,
      eligibleFiles: eligible,
      incompleteFiles: jsEligible.filter((f) => !importsKnown(f)).length,
      skipped: skipTally((f) => (f.isGenerated ? 'generated file' : !importsKnown(f) ? 'imports not analysed' : null)),
      findings: issues.length - before,
    });
  }

  const sevOrder = { error: 0, warning: 1, info: 2 } as const;
  issues.sort(
    (a, b) =>
      sevOrder[a.severity] - sevOrder[b.severity] ||
      a.type.localeCompare(b.type) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0)
  );
  return { issues, rules };
}
