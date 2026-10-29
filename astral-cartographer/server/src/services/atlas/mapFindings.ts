import type { AtlasData } from './types.js';
import { THRESHOLDS } from '../analysis/architecture.js';

const LANGS = /\.(py|pyi|go|java)$/;
const TEST = /(^|\/)(tests?|__tests__)\/|_test\.go$|(^|\/)test_[^/]+\.py$|Tests?\.java$|(^|\/)src\/test\//;

/**
 * Architectural findings for Python, Go and Java files, from the Dependency Atlas (the main analyzer's rules run on
 * JS/TS only). Same rules, thresholds and wording as services/analysis/architecture.ts.
 */
export function mapFindings(atlas: AtlasData): any[] {
  const issues: any[] = [];
  const own = (p: string) => LANGS.test(p);
  for (const cycle of atlas.cycles) {
    if (!cycle.some(own)) continue;
    issues.push({
      id: `map-cycle:${cycle.join(',')}`, type: 'circular_dependency', severity: 'error', confidence: 'confirmed',
      file: cycle[0], affectedFiles: cycle.slice(0, THRESHOLDS.MAX_LISTED_FILES),
      description: `Circular dependency detected: ${[...cycle, cycle[0]].join(' -> ')}.`, rule: 'No Circular Dependencies',
    });
  }
  const out = new Map<string, Set<string>>(), inn = new Map<string, Set<string>>();
  for (const e of atlas.edges) {
    if (!e.to || e.from === e.to) continue;
    (out.get(e.from) ?? out.set(e.from, new Set()).get(e.from)!).add(e.to);
    if (!TEST.test(e.from)) (inn.get(e.to) ?? inn.set(e.to, new Set()).get(e.to)!).add(e.from);
  }
  for (const f of atlas.files) {
    if (!own(f.path) || TEST.test(f.path)) continue;
    const o = out.get(f.path)?.size ?? 0, i = inn.get(f.path)?.size ?? 0;
    if (o > THRESHOLDS.MAX_FAN_OUT || i > THRESHOLDS.MAX_FAN_IN) {
      issues.push({ id: `map-coupling:${f.path}`, type: 'high_coupling', severity: 'warning', confidence: 'heuristic', file: f.path, affectedFiles: [f.path],
        description: `Hub module with high coupling: imports ${o} local modules and is imported by ${i} modules (thresholds: more than ${THRESHOLDS.MAX_FAN_OUT} imports or ${THRESHOLDS.MAX_FAN_IN} importers). Consider decoupling dependencies.`, rule: 'Decoupled Architecture' });
    }
    const fns = f.functions.filter((x) => x.kind !== 'class').length;
    if (f.lines > THRESHOLDS.MAX_LINES || fns > THRESHOLDS.MAX_FUNCTIONS) {
      issues.push({ id: `map-size:${f.path}`, type: 'oversized_file', severity: 'warning', confidence: 'heuristic', file: f.path, line: 1, affectedFiles: [f.path],
        description: `Module exceeds recommended size (${f.lines} lines, ${fns} functions; thresholds: ${THRESHOLDS.MAX_LINES} lines or ${THRESHOLDS.MAX_FUNCTIONS} functions). Consider breaking into smaller modules.`, rule: 'Single Responsibility Principle' });
    }
  }
  // deep relative imports: Python "from ...x import y" climbs 2+ packages (3 dots)
  for (const e of atlas.edges) {
    if (/\.pyi?$/.test(e.from) && /^\.{3,}/.test(e.specifier)) {
      issues.push({ id: `map-deep:${e.from}:${e.specifier}`, type: 'deep_import_nesting', severity: 'info', confidence: 'heuristic', file: e.from, line: e.line, affectedFiles: [e.from],
        description: `Deep relative import path ("${e.specifier}"). Consider configuring module path aliases for cleaner architecture.`, rule: 'Clean Module Hierarchy' });
    }
  }
  return [...new Map(issues.map((i) => [i.id, i])).values()];
}
