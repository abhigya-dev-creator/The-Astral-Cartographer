import { parse } from '@babel/parser';
import crypto from 'crypto';
import type {
  CodeInspectionResult,
  CodeInspectionSummary,
  CodeIssue,
  InspectionRule,
  IssueCategory,
  RuleContext,
} from './types.js';
import { unreachableCodeRule, unusedVariableRule } from './rules/unusedAndUnreachable.js';
import { nullUndefinedAccessRule } from './rules/nullUndefined.js';
import { divisionByZeroRule } from './rules/divisionByZero.js';
import { suspiciousLoopRule } from './rules/suspiciousLoops.js';
import { logicalErrorRule } from './rules/logicalErrors.js';
import { resourceManagementRule } from './rules/resourceManagement.js';
import { securityVulnerabilitiesRule } from './rules/securityVulnerabilities.js';

export const ALL_RULES: InspectionRule[] = [
  unreachableCodeRule,
  unusedVariableRule,
  nullUndefinedAccessRule,
  divisionByZeroRule,
  suspiciousLoopRule,
  logicalErrorRule,
  resourceManagementRule,
  securityVulnerabilitiesRule,
];

const BASE_PLUGINS: any[] = [
  'decorators-legacy',
  'exportDefaultFrom',
  'importAttributes',
  'explicitResourceManagement',
];

function getBabelPlugins(ext: string): any[][] {
  const lower = ext.toLowerCase();
  if (lower === '.tsx') return [['typescript', 'jsx'], ['typescript']];
  if (lower === '.ts' || lower === '.mts' || lower === '.cts') return [['typescript'], ['typescript', 'jsx']];
  return [['jsx'], ['jsx', 'flow'], ['typescript', 'jsx']];
}

function parseCodeToAst(code: string, ext: string): any | null {
  for (const extra of getBabelPlugins(ext)) {
    try {
      const ast = parse(code, {
        sourceType: 'unambiguous',
        plugins: [...BASE_PLUGINS, ...extra],
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowSuperOutsideMethod: true,
        allowUndeclaredExports: true,
      });
      return ast;
    } catch {
      // try next fallback
    }
  }
  return null;
}

export function inspectSourceCode(
  code: string,
  filePath: string,
  rules: InspectionRule[] = ALL_RULES
): CodeInspectionResult {
  const start = Date.now();
  const ext = (filePath.includes('.') ? '.' + filePath.split('.').pop()! : '').toLowerCase();
  const lines = code.split(/\r?\n/);
  const rawIssues: CodeIssue[] = [];

  const addIssue = (
    issue: Omit<CodeIssue, 'id' | 'file'> & { line: number; column?: number }
  ) => {
    const clampedLine = Math.max(1, Math.min(issue.line, lines.length || 1));
    const snippet = issue.codeSnippet || lines[clampedLine - 1]?.trim() || '';
    const id = crypto
      .createHash('sha1')
      .update(`${issue.ruleId}|${filePath}|${clampedLine}|${issue.message}`)
      .digest('hex')
      .slice(0, 12);

    rawIssues.push({
      ...issue,
      id,
      file: filePath,
      line: clampedLine,
      codeSnippet: snippet,
    });
  };

  const ast = parseCodeToAst(code, ext);

  const context: RuleContext = {
    ast,
    code,
    lines,
    filePath,
    extension: ext,
    addIssue,
  };

  // Run AST-based rules
  for (const rule of rules) {
    try {
      rule.check(context);
    } catch (err: any) {
      console.warn(`[CodeInspection] Rule '${rule.id}' failed on ${filePath}:`, err?.message || err);
    }
  }

  // Deduplicate issues by (ruleId, line, message)
  const seen = new Set<string>();
  const issues: CodeIssue[] = [];

  for (const issue of rawIssues) {
    const key = `${issue.ruleId}:${issue.line}:${issue.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  }

  // Sort by line ascending, then severity (error > warning > info)
  const sevWeight = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => a.line - b.line || sevWeight[a.severity] - sevWeight[b.severity]);

  const summary = computeSummary(issues);
  const durationMs = Date.now() - start;

  return {
    file: filePath,
    issues,
    summary,
    durationMs,
  };
}

function computeSummary(issues: CodeIssue[]): CodeInspectionSummary {
  const summary: CodeInspectionSummary = {
    total: issues.length,
    errors: 0,
    warnings: 0,
    info: 0,
    confirmed: 0,
    heuristic: 0,
    byCategory: {
      unused_or_unreachable: 0,
      null_undefined: 0,
      division_by_zero: 0,
      suspicious_loop: 0,
      logical_error: 0,
      resource_management: 0,
      security: 0,
      ai_detected: 0,
    },
  };

  for (const issue of issues) {
    if (issue.severity === 'error') summary.errors++;
    else if (issue.severity === 'warning') summary.warnings++;
    else if (issue.severity === 'info') summary.info++;

    if (issue.confidence === 'confirmed') summary.confirmed++;
    else summary.heuristic++;

    if (summary.byCategory[issue.category] !== undefined) {
      summary.byCategory[issue.category]++;
    }
  }

  return summary;
}
