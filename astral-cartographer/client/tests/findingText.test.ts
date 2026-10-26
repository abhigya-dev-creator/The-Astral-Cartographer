import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainFinding, summarizeFindings } from '../src/features/atlas/findingText';
import type { IArchitecturalIssue } from '../src/lib/api';

// Descriptions below are the analyzer's exact wording (server/src/services/analysis/architecture.ts).
const issue = (o: Partial<IArchitecturalIssue>): IArchitecturalIssue => ({ type: 'x', severity: 'warning', file: 'src/a.ts', description: '', rule: 'Rule', ...o });

test('circular dependencies become a plain loop with the file names', () => {
  const p = explainFinding(issue({ type: 'circular_dependency', severity: 'error', confidence: 'confirmed', description: 'Circular dependency detected: src/lib/api.ts -> src/lib/supabase.ts -> src/lib/api.ts.' }));
  assert.equal(p.headline, 'Files depend on each other in a loop');
  assert.equal(p.level, 'Serious');
  assert.deepEqual(p.loop, ['api.ts', 'supabase.ts', 'api.ts']);
  assert.match(p.what, /api\.ts → supabase\.ts → api\.ts/);
  assert.match(p.certainty, /^Certain/);
  const lazy = explainFinding(issue({ type: 'circular_dependency', severity: 'info', description: 'Circular dependency that exists only through dynamic import() or type-only imports (not at module load time): a.ts -> b.ts -> a.ts. The cycle belongs to a tangled group of 3 mutually dependent files.' }));
  assert.equal(lazy.level, 'Minor');
  assert.deepEqual(lazy.loop, ['a.ts', 'b.ts', 'a.ts']);
  assert.match(lazy.what, /does not break the app/);
});

test('coupling, size and deep imports read their numbers from the analyzer text', () => {
  const c = explainFinding(issue({ type: 'high_coupling', description: 'Hub module with high coupling: imports 3 local modules and is imported by 35 modules (thresholds: more than 12 imports or 15 importers). Consider decoupling dependencies.' }));
  assert.match(c.what, /uses 3 other files of the project, and 35 files use it/);
  assert.match(c.certainty, /^Rule of thumb/);
  const s = explainFinding(issue({ type: 'oversized_file', description: 'Module exceeds recommended size (629 lines, 31 functions; thresholds: 500 lines or 25 functions). Consider breaking into smaller modules.' }));
  assert.match(s.what, /629 lines and 31 functions/);
  const s2 = explainFinding(issue({ type: 'oversized_file', description: 'Module exceeds recommended size (1200 lines, function count unavailable; thresholds: 500 lines or 25 functions).' }));
  assert.match(s2.what, /1,200 lines\./);
  const d = explainFinding(issue({ type: 'deep_import_nesting', severity: 'info', description: 'Deep relative import path ("../../../lib/api"). Consider configuring module path aliases for cleaner architecture.' }));
  assert.match(d.what, /"\.\.\/\.\.\/\.\.\/lib\/api"/);
});

test('unknown types and formats fall back to the original text', () => {
  const u = explainFinding(issue({ type: 'something_new', rule: 'New Rule', description: 'Original words.' }));
  assert.deepEqual([u.headline, u.what], ['New Rule', 'Original words.']);
  const c = explainFinding(issue({ type: 'high_coupling', description: 'changed wording' }));
  assert.match(c.what, /more files than the recommended limit/);
  assert.equal(summarizeFindings([issue({ severity: 'error' }), issue({}), issue({})]), '3 possible design problems (1 serious, 2 worth fixing)');
});
