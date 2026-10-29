import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

export const divisionByZeroRule: InspectionRule = {
  id: 'division-by-zero',
  name: 'Division or Modulo by Zero',
  category: 'division_by_zero',
  defaultSeverity: 'error',
  confidence: 'confirmed',
  description: 'Identifies division (/) or remainder (%) operations where the denominator is zero or evaluate directly to zero.',
  check(context: RuleContext) {
    if (!context.ast) return;

    // Track variables assigned to literal 0 in scope
    const zeroVariables = new Map<string, number>();

    traverse(context.ast, {
      VariableDeclarator(path: any) {
        const id = path.node.id;
        const init = path.node.init;
        if (id?.type === 'Identifier' && isZeroNode(init)) {
          zeroVariables.set(id.name, id.loc?.start?.line || 0);
        }
      },

      AssignmentExpression(path: any) {
        const left = path.node.left;
        const right = path.node.right;
        if (left?.type === 'Identifier') {
          if (isZeroNode(right)) {
            zeroVariables.set(left.name, left.loc?.start?.line || 0);
          } else {
            zeroVariables.delete(left.name);
          }
        }
      },

      BinaryExpression(path: any) {
        const op = path.node.operator;
        if (op !== '/' && op !== '%') return;

        const right = path.node.right;
        const line = path.node.loc?.start?.line || right.loc?.start?.line || 0;

        // Case 1: Literal zero
        if (isZeroNode(right)) {
          context.addIssue({
            ruleId: divisionByZeroRule.id,
            ruleName: divisionByZeroRule.name,
            category: divisionByZeroRule.category,
            severity: 'error',
            confidence: 'confirmed',
            line,
            column: right.loc?.start?.column,
            message: `Division or modulo by literal zero (${op} 0).`,
            explanation: `Dividing by literal zero produces Infinity, -Infinity, or NaN (in the case of modulo or 0/0). This almost always represents a mathematical bug or missing condition.`,
            suggestedFix: `Check that the divisor is non-zero before performing the operation, or provide an appropriate fallback.`,
            codeSnippet: context.lines[line - 1]?.trim(),
          });
          return;
        }

        // Case 2: Variable known to be zero
        if (right.type === 'Identifier' && zeroVariables.has(right.name)) {
          const declLine = zeroVariables.get(right.name);
          context.addIssue({
            ruleId: divisionByZeroRule.id,
            ruleName: divisionByZeroRule.name,
            category: divisionByZeroRule.category,
            severity: 'warning',
            confidence: 'heuristic',
            line,
            column: right.loc?.start?.column,
            message: `Potential division by zero: divisor '${right.name}' was assigned 0 on line ${declLine}.`,
            explanation: `The variable '${right.name}' is set to 0 and used as the denominator without an intervening check or reassignment.`,
            suggestedFix: `Ensure '${right.name}' is guarded against zero before division: e.g. '${right.name} !== 0 ? value / ${right.name} : defaultVal'.`,
            codeSnippet: context.lines[line - 1]?.trim(),
          });
        }
      },
    });
  },
};

function isZeroNode(node: any): boolean {
  if (!node) return false;
  if (node.type === 'NumericLiteral' && node.value === 0) return true;
  if (node.type === 'BigIntLiteral' && (node.value === '0' || node.value === '0n')) return true;
  if (node.type === 'UnaryExpression' && node.operator === '-' && isZeroNode(node.argument)) return true;
  return false;
}
