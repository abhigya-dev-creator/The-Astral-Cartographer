import type { Node } from '@babel/types';

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueConfidence = 'confirmed' | 'heuristic';

export type IssueCategory =
  | 'unused_or_unreachable'
  | 'null_undefined'
  | 'division_by_zero'
  | 'suspicious_loop'
  | 'logical_error'
  | 'resource_management'
  | 'security'
  | 'ai_detected';

export interface CodeIssue {
  id: string;
  ruleId: string;
  ruleName: string;
  category: IssueCategory;
  severity: IssueSeverity;
  confidence: IssueConfidence;
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  explanation: string;
  suggestedFix?: string;
  codeSnippet?: string;
}

export interface RuleContext {
  ast: any;
  code: string;
  lines: string[];
  filePath: string;
  extension: string;
  addIssue: (
    issue: Omit<CodeIssue, 'id' | 'file'> & { line: number; column?: number }
  ) => void;
}

export interface InspectionRule {
  id: string;
  name: string;
  category: IssueCategory;
  defaultSeverity: IssueSeverity;
  confidence: IssueConfidence;
  description: string;
  check: (context: RuleContext) => void;
}

export interface CodeInspectionSummary {
  total: number;
  errors: number;
  warnings: number;
  info: number;
  confirmed: number;
  heuristic: number;
  byCategory: Record<IssueCategory, number>;
}

export interface CodeInspectionResult {
  file: string;
  issues: CodeIssue[];
  summary: CodeInspectionSummary;
  durationMs: number;
}
