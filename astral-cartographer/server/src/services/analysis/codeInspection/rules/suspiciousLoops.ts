import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

export const suspiciousLoopRule: InspectionRule = {
  id: 'suspicious-loop',
  name: 'Potentially Infinite or Ill-Conditioned Loop',
  category: 'suspicious_loop',
  defaultSeverity: 'error',
  confidence: 'confirmed',
  description: 'Detects loops that may never terminate because their termination conditions are constant or their counter variables update in the wrong direction.',
  check(context: RuleContext) {
    if (!context.ast) return;

    traverse(context.ast, {
      WhileStatement(path: any) {
        checkWhileLoop(path, context);
      },
      DoWhileStatement(path: any) {
        checkWhileLoop(path, context);
      },
      ForStatement(path: any) {
        checkForLoop(path, context);
      },
    });
  },
};

function hasLoopExit(loopPath: any): boolean {
  if (!loopPath) return false;
  let exitFound = false;

  try {
    loopPath.traverse({
      BreakStatement(p: any) {
        if (!p.node.label) exitFound = true;
      },
      ReturnStatement() {
        exitFound = true;
      },
      ThrowStatement() {
        exitFound = true;
      },
      Function(p: any) {
        p.skip();
      },
    });
  } catch {
    // fallback
  }

  return exitFound;
}

function checkWhileLoop(path: any, context: RuleContext) {
  const test = path.node.test;
  const line = path.node.loc?.start?.line || 0;

  // Check for constant truthy condition: while(true), while(1), while(!0)
  const isConstantTrue =
    (test.type === 'BooleanLiteral' && test.value === true) ||
    (test.type === 'NumericLiteral' && test.value !== 0) ||
    (test.type === 'UnaryExpression' && test.operator === '!' && test.argument.type === 'NumericLiteral' && test.argument.value === 0);

  if (isConstantTrue) {
    const hasExit = hasLoopExit(path);
    if (!hasExit) {
      context.addIssue({
        ruleId: suspiciousLoopRule.id,
        ruleName: suspiciousLoopRule.name,
        category: suspiciousLoopRule.category,
        severity: 'error',
        confidence: 'confirmed',
        line,
        column: path.node.loc?.start?.column,
        message: 'Infinite loop detected: loop condition is always true with no break or return.',
        explanation: 'This while/do-while loop has an unconditionally truthy test and contains no break, return, or throw statement in its body. When executed, it will run indefinitely and freeze the thread or process.',
        suggestedFix: 'Add a termination check with a break or return statement inside the loop body, or adjust the loop condition.',
        codeSnippet: context.lines[line - 1]?.trim(),
      });
      return;
    }
  }

  // Check for simple identifier condition not modified in body: while(x < 10)
  if (test.type === 'BinaryExpression') {
    const ids: string[] = [];
    if (test.left.type === 'Identifier') ids.push(test.left.name);
    if (test.right.type === 'Identifier') ids.push(test.right.name);

    if (ids.length > 0 && !hasLoopExit(path)) {
      let anyModified = false;
      try {
        path.traverse({
          UpdateExpression(p: any) {
            if (p.node.argument.type === 'Identifier' && ids.includes(p.node.argument.name)) {
              anyModified = true;
            }
          },
          AssignmentExpression(p: any) {
            if (p.node.left.type === 'Identifier' && ids.includes(p.node.left.name)) {
              anyModified = true;
            }
          },
          Function(p: any) {
            p.skip();
          },
        });
      } catch {
        // fallback
      }

      if (!anyModified) {
        context.addIssue({
          ruleId: suspiciousLoopRule.id,
          ruleName: suspiciousLoopRule.name,
          category: suspiciousLoopRule.category,
          severity: 'warning',
          confidence: 'heuristic',
          line,
          column: path.node.loc?.start?.column,
          message: `Suspicious loop: variables in condition (${ids.join(', ')}) are never modified inside the loop body.`,
          explanation: `The loop condition depends on ${ids.join(', ')}, but no assignment or increment/decrement updates these variables inside the loop. Unless modified asynchronously or by an external function call, this loop will not terminate.`,
          suggestedFix: `Ensure the loop counter or state variable (${ids[0]}) is updated within each iteration, or verify exit conditions.`,
          codeSnippet: context.lines[line - 1]?.trim(),
        });
      }
    }
  }
}

function checkForLoop(path: any, context: RuleContext) {
  const { init, test, update, loc } = path.node;
  const line = loc?.start?.line || 0;

  // for (;;) without break
  if (!test && !update) {
    if (!hasLoopExit(path)) {
      context.addIssue({
        ruleId: suspiciousLoopRule.id,
        ruleName: suspiciousLoopRule.name,
        category: suspiciousLoopRule.category,
        severity: 'error',
        confidence: 'confirmed',
        line,
        column: loc?.start?.column,
        message: 'Infinite for-loop: empty condition with no break or return.',
        explanation: 'A for (;;) loop with an omitted condition runs forever unless broken with a break, return, or throw statement.',
        suggestedFix: 'Add a loop condition or a break statement.',
        codeSnippet: context.lines[line - 1]?.trim(),
      });
      return;
    }
  }

  // Detect counter moving in wrong direction
  // e.g. for (let i = 0; i < N; i--)
  // or   for (let i = 10; i > 0; i++)
  if (init && test && update) {
    let counterVar = '';
    if (init.type === 'VariableDeclaration' && init.declarations[0]?.id?.type === 'Identifier') {
      counterVar = init.declarations[0].id.name;
    } else if (init.type === 'AssignmentExpression' && init.left.type === 'Identifier') {
      counterVar = init.left.name;
    }

    if (counterVar && test.type === 'BinaryExpression' && update.type === 'UpdateExpression') {
      const isCounterOnLeft = test.left.type === 'Identifier' && test.left.name === counterVar;
      const isUpdateSameVar = update.argument.type === 'Identifier' && update.argument.name === counterVar;

      if (isCounterOnLeft && isUpdateSameVar) {
        const op = test.operator; // '<', '<=', '>', '>='
        const step = update.operator; // '++', '--'

        // Bound is greater (i < N), but counter is decremented (i--)
        if ((op === '<' || op === '<=') && step === '--') {
          context.addIssue({
            ruleId: suspiciousLoopRule.id,
            ruleName: suspiciousLoopRule.name,
            category: suspiciousLoopRule.category,
            severity: 'error',
            confidence: 'confirmed',
            line,
            column: loc?.start?.column,
            message: `Counter '${counterVar}' decrements (${counterVar}--) while condition checks '${counterVar} ${op} bound', causing an infinite loop.`,
            explanation: `The loop condition expects '${counterVar}' to remain less than the bound, but the update expression decrements '${counterVar}', moving it further away from the termination condition.`,
            suggestedFix: `Change '${counterVar}--' to '${counterVar}++' or correct the termination boundary condition.`,
            codeSnippet: context.lines[line - 1]?.trim(),
          });
        }
        // Bound is smaller (i > 0), but counter is incremented (i++)
        else if ((op === '>' || op === '>=') && step === '++') {
          context.addIssue({
            ruleId: suspiciousLoopRule.id,
            ruleName: suspiciousLoopRule.name,
            category: suspiciousLoopRule.category,
            severity: 'error',
            confidence: 'confirmed',
            line,
            column: loc?.start?.column,
            message: `Counter '${counterVar}' increments (${counterVar}++) while condition checks '${counterVar} ${op} bound', causing an infinite loop.`,
            explanation: `The loop condition expects '${counterVar}' to remain greater than the bound, but the update expression increments '${counterVar}', moving it continuously away from the termination condition.`,
            suggestedFix: `Change '${counterVar}++' to '${counterVar}--' or correct the termination condition.`,
            codeSnippet: context.lines[line - 1]?.trim(),
          });
        }
      }
    }
  }
}
