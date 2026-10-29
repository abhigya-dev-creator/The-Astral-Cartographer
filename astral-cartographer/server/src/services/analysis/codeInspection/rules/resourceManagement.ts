import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

export const resourceManagementRule: InspectionRule = {
  id: 'resource-management',
  name: 'Unmanaged Resource, Unclosed File Handle or Timer',
  category: 'resource_management',
  defaultSeverity: 'warning',
  confidence: 'heuristic',
  description: 'Detects resources like file handles (fs.open), streams, or intervals that are allocated without proper cleanup or error-safe release.',
  check(context: RuleContext) {
    if (!context.ast) return;

    let hasFsOpen = false;
    let hasFsClose = false;
    let fsOpenLine = 0;

    traverse(context.ast, {
      CallExpression(path: any) {
        const callee = path.node.callee;
        const line = path.node.loc?.start?.line || 0;

        // 1. Check for unmanaged setInterval: setInterval(...) without storing ID
        if (callee.type === 'Identifier' && callee.name === 'setInterval') {
          const parent = path.parent;
          // If parent is an expression statement (e.g. `setInterval(fn, 1000);`)
          if (parent?.type === 'ExpressionStatement') {
            context.addIssue({
              ruleId: resourceManagementRule.id,
              ruleName: resourceManagementRule.name,
              category: resourceManagementRule.category,
              severity: 'info',
              confidence: 'heuristic',
              line,
              column: path.node.loc?.start?.column,
              message: "Recurring timer 'setInterval()' invoked without saving its timer ID for cleanup.",
              explanation: "Calling 'setInterval()' without capturing the returned timer identifier prevents clearing the timer with 'clearInterval()', which can lead to memory leaks and background CPU consumption when components unmount or operations complete.",
              suggestedFix: "Store the timer ID in a variable or ref (e.g. 'const timerId = setInterval(...)') and ensure 'clearInterval(timerId)' is called upon cleanup.",
              codeSnippet: context.lines[line - 1]?.trim(),
            });
          }
        }

        // 2. Check for fs.open / fs.openSync
        if (callee.type === 'MemberExpression') {
          const propName = callee.property.type === 'Identifier' ? callee.property.name : '';
          if (propName === 'open' || propName === 'openSync') {
            hasFsOpen = true;
            fsOpenLine = line;
          }
          if (propName === 'close' || propName === 'closeSync') {
            hasFsClose = true;
          }
        }
      },
    });

    if (hasFsOpen && !hasFsClose) {
      context.addIssue({
        ruleId: resourceManagementRule.id,
        ruleName: resourceManagementRule.name,
        category: resourceManagementRule.category,
        severity: 'warning',
        confidence: 'heuristic',
        line: fsOpenLine,
        message: 'File descriptor opened via fs.open/fs.openSync without a matching close/closeSync in the module.',
        explanation: 'Acquiring file descriptors without ensuring they are closed (ideally in a try/finally block) risks leaking file descriptors, eventually exhausting OS limits.',
        suggestedFix: 'Wrap file operations in a try/finally block and ensure fs.close/fs.closeSync is called in finally, or use fs.promises APIs.',
        codeSnippet: context.lines[fsOpenLine - 1]?.trim(),
      });
    }
  },
};
