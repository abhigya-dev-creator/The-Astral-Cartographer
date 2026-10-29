import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

export const logicalErrorRule: InspectionRule = {
  id: 'logical-error',
  name: 'Potential Logical Error or Flawed Condition',
  category: 'logical_error',
  defaultSeverity: 'warning',
  confidence: 'confirmed',
  description: 'Identifies self-comparisons, assignment in conditionals, duplicate conditions in else-if chains, and identical if/else branches.',
  check(context: RuleContext) {
    if (!context.ast) return;

    traverse(context.ast, {
      // 1. Self comparison: x === x, a != a, x > x
      BinaryExpression(path: any) {
        const { operator, left, right, loc } = path.node;
        const line = loc?.start?.line || 0;

        if (
          ['===', '!==', '==', '!=', '>', '<', '>=', '<='].includes(operator)
        ) {
          if (areNodesEquivalent(left, right)) {
            const leftStr = context.code.slice(left.start, left.end);
            context.addIssue({
              ruleId: logicalErrorRule.id,
              ruleName: logicalErrorRule.name,
              category: logicalErrorRule.category,
              severity: 'warning',
              confidence: 'confirmed',
              line,
              column: loc?.start?.column,
              message: `Self-comparison detected: '${leftStr} ${operator} ${leftStr}'.`,
              explanation: `Comparing an operand to itself (${leftStr} ${operator} ${leftStr}) is either a no-op or always evaluates to a constant result (true/false), usually indicating a typo or copy-paste mistake.`,
              suggestedFix: `If checking for NaN, use 'Number.isNaN(${leftStr})'. Otherwise, compare against the intended distinct variable or value.`,
              codeSnippet: context.lines[line - 1]?.trim(),
            });
          }
        }
      },

      // 2. Assignment in conditional: if (x = 5)
      IfStatement(path: any) {
        checkConditional(path.node.test, context);
        checkIfElseBranches(path, context);
      },
      WhileStatement(path: any) {
        checkConditional(path.node.test, context);
      },
      DoWhileStatement(path: any) {
        checkConditional(path.node.test, context);
      },
      ForStatement(path: any) {
        if (path.node.test) checkConditional(path.node.test, context);
      },
    });
  },
};

function checkConditional(testNode: any, context: RuleContext) {
  if (!testNode) return;
  const line = testNode.loc?.start?.line || 0;

  // Single assignment: if (x = 5)
  if (testNode.type === 'AssignmentExpression' && testNode.operator === '=') {
    const leftName = testNode.left.type === 'Identifier' ? testNode.left.name : 'variable';
    context.addIssue({
      ruleId: logicalErrorRule.id,
      ruleName: logicalErrorRule.name,
      category: logicalErrorRule.category,
      severity: 'warning',
      confidence: 'heuristic',
      line,
      column: testNode.loc?.start?.column,
      message: `Assignment operator '=' used within conditional test expression (assigning to '${leftName}').`,
      explanation: `Using a single '=' assigns a value instead of checking equality. If you intended to compare values, use '===' or '=='.`,
      suggestedFix: `Replace '=' with '===' for comparison, or wrap in double parentheses 'if ((${leftName} = ...))' if assignment was intended.`,
      codeSnippet: context.lines[line - 1]?.trim(),
    });
  }

  // Bitwise operator instead of logical: if (a & b) where both sides are comparisons
  if (
    testNode.type === 'BinaryExpression' &&
    (testNode.operator === '&' || testNode.operator === '|') &&
    (isComparison(testNode.left) || isComparison(testNode.right))
  ) {
    const intendedOp = testNode.operator === '&' ? '&&' : '||';
    context.addIssue({
      ruleId: logicalErrorRule.id,
      ruleName: logicalErrorRule.name,
      category: logicalErrorRule.category,
      severity: 'warning',
      confidence: 'heuristic',
      line,
      column: testNode.loc?.start?.column,
      message: `Bitwise operator '${testNode.operator}' used in conditional between boolean comparisons; did you mean '${intendedOp}'?`,
      explanation: `The bitwise operator '${testNode.operator}' does not short-circuit and operates at bit level. Logical '${intendedOp}' is typically intended in conditional statements.`,
      suggestedFix: `Replace '${testNode.operator}' with '${intendedOp}'.`,
      codeSnippet: context.lines[line - 1]?.trim(),
    });
  }
}

function checkIfElseBranches(path: any, context: RuleContext) {
  const { consequent, alternate, loc } = path.node;
  const line = loc?.start?.line || 0;

  // Check 1: Identical branches: if (...) { A } else { A }
  if (alternate && alternate.type !== 'IfStatement') {
    if (areNodesEquivalent(consequent, alternate)) {
      context.addIssue({
        ruleId: logicalErrorRule.id,
        ruleName: logicalErrorRule.name,
        category: logicalErrorRule.category,
        severity: 'warning',
        confidence: 'confirmed',
        line,
        column: loc?.start?.column,
        message: 'Identical code in both "if" and "else" branches.',
        explanation: 'The consequent and alternate branches execute identical logic, making the conditional statement redundant or indicating an unfinished implementation.',
        suggestedFix: 'Implement the distinct alternative branch logic or remove the redundant condition.',
        codeSnippet: context.lines[line - 1]?.trim(),
      });
    }
  }

  // Check 2: Duplicate conditions in else-if chain: if (a) ... else if (a)
  if (alternate && alternate.type === 'IfStatement') {
    const seenConditions = [context.code.slice(path.node.test.start, path.node.test.end).trim()];
    let current = alternate;

    while (current && current.type === 'IfStatement') {
      const condStr = context.code.slice(current.test.start, current.test.end).trim();
      const currentLine = current.test.loc?.start?.line || 0;

      if (seenConditions.includes(condStr)) {
        context.addIssue({
          ruleId: logicalErrorRule.id,
          ruleName: logicalErrorRule.name,
          category: logicalErrorRule.category,
          severity: 'error',
          confidence: 'confirmed',
          line: currentLine,
          column: current.test.loc?.start?.column,
          message: `Duplicate condition in 'else if': '${condStr}' was already checked in an earlier branch.`,
          explanation: `This 'else if' branch tests the exact same condition ('${condStr}') as a preceding branch. It will never be reached because the earlier branch always matches first.`,
          suggestedFix: `Update the condition to test a different value or remove the duplicate branch.`,
          codeSnippet: context.lines[currentLine - 1]?.trim(),
        });
      } else {
        seenConditions.push(condStr);
      }

      current = current.alternate;
    }
  }
}

function isComparison(node: any): boolean {
  if (!node) return false;
  return (
    node.type === 'BinaryExpression' &&
    ['===', '!==', '==', '!=', '>', '<', '>=', '<='].includes(node.operator)
  );
}

function areNodesEquivalent(a: any, b: any): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;

  if (a.type === 'Identifier') {
    return a.name === b.name;
  }
  if (a.type === 'NumericLiteral' || a.type === 'StringLiteral' || a.type === 'BooleanLiteral') {
    return a.value === b.value;
  }
  if (a.type === 'MemberExpression') {
    return (
      areNodesEquivalent(a.object, b.object) &&
      areNodesEquivalent(a.property, b.property) &&
      a.computed === b.computed
    );
  }
  if (a.type === 'BlockStatement') {
    if (a.body.length !== b.body.length) return false;
    for (let i = 0; i < a.body.length; i++) {
      if (!areNodesEquivalent(a.body[i], b.body[i])) return false;
    }
    return true;
  }
  if (a.type === 'ExpressionStatement') {
    return areNodesEquivalent(a.expression, b.expression);
  }
  if (a.type === 'CallExpression') {
    if (!areNodesEquivalent(a.callee, b.callee)) return false;
    if (a.arguments.length !== b.arguments.length) return false;
    for (let i = 0; i < a.arguments.length; i++) {
      if (!areNodesEquivalent(a.arguments[i], b.arguments[i])) return false;
    }
    return true;
  }
  if (a.type === 'ReturnStatement') {
    return areNodesEquivalent(a.argument, b.argument);
  }

  return false;
}
