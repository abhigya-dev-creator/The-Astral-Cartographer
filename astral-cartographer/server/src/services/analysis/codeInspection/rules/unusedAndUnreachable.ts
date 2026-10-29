import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

export const unreachableCodeRule: InspectionRule = {
  id: 'unreachable-code',
  name: 'Unreachable Code After Control Flow Jump',
  category: 'unused_or_unreachable',
  defaultSeverity: 'error',
  confidence: 'confirmed',
  description: 'Statements placed immediately after a return, throw, break, or continue in the same block will never be executed.',
  check(context: RuleContext) {
    if (!context.ast) return;

    traverse(context.ast, {
      BlockStatement(path: any) {
        checkStatementList(path.node.body, context);
      },
      Program(path: any) {
        checkStatementList(path.node.body, context);
      },
      SwitchCase(path: any) {
        checkStatementList(path.node.consequent, context);
      },
    });
  },
};

function checkStatementList(body: any[], context: RuleContext) {
  if (!Array.isArray(body)) return;
  let exitFound = false;
  let exitStatementType = '';
  let exitLine = 0;

  for (const stmt of body) {
    if (exitFound) {
      // Don't flag function declarations (hoisted)
      if (stmt.type === 'FunctionDeclaration') continue;
      const line = stmt.loc?.start?.line;
      if (!line) continue;

      context.addIssue({
        ruleId: unreachableCodeRule.id,
        ruleName: unreachableCodeRule.name,
        category: unreachableCodeRule.category,
        severity: unreachableCodeRule.defaultSeverity,
        confidence: unreachableCodeRule.confidence,
        line,
        column: stmt.loc?.start?.column,
        message: `Unreachable statement detected following '${exitStatementType}' on line ${exitLine}.`,
        explanation: `This statement follows an unconditional control flow transfer (${exitStatementType}) on line ${exitLine}. It can never execute and is dead code.`,
        suggestedFix: `Remove the unreachable code or move it before the '${exitStatementType}' statement.`,
        codeSnippet: context.lines[line - 1]?.trim(),
      });
      // Only report the first unreachable statement in a sequence to avoid alert fatigue
      break;
    }

    if (
      stmt.type === 'ReturnStatement' ||
      stmt.type === 'ThrowStatement' ||
      stmt.type === 'BreakStatement' ||
      stmt.type === 'ContinueStatement'
    ) {
      exitFound = true;
      exitStatementType = stmt.type.replace('Statement', '').toLowerCase();
      exitLine = stmt.loc?.start?.line || 0;
    }
  }
}

export const unusedVariableRule: InspectionRule = {
  id: 'unused-variable',
  name: 'Unused Local Variable Declaration',
  category: 'unused_or_unreachable',
  defaultSeverity: 'warning',
  confidence: 'heuristic',
  description: 'A local variable or constant is declared and initialized but never referenced within its scope.',
  check(context: RuleContext) {
    if (!context.ast) return;

    try {
      traverse(context.ast, {
        Program(path: any) {
          scanScopeBindings(path.scope, context);
        },
        Function(path: any) {
          scanScopeBindings(path.scope, context);
        },
        BlockStatement(path: any) {
          scanScopeBindings(path.scope, context);
        },
      });
    } catch {
      // If Babel scope crawl fails on a partial AST, fail gracefully
    }
  },
};

function scanScopeBindings(scope: any, context: RuleContext) {
  if (!scope || !scope.bindings) return;

  for (const [name, binding] of Object.entries<any>(scope.bindings)) {
    // Ignore conventional unused indicators: starts with _
    if (name.startsWith('_')) continue;
    // Ignore React or global identifiers
    if (name === 'React') continue;
    // Ignore parameters (focus strictly on local declarations)
    if (binding.kind !== 'let' && binding.kind !== 'const' && binding.kind !== 'var') continue;

    // Check if referenced
    if (!binding.referenced && binding.identifier?.loc?.start?.line) {
      // Skip if exported
      const parent = binding.path?.parent;
      if (
        parent?.type === 'ExportNamedDeclaration' ||
        parent?.type === 'ExportDefaultDeclaration'
      ) {
        continue;
      }

      const line = binding.identifier.loc.start.line;
      context.addIssue({
        ruleId: unusedVariableRule.id,
        ruleName: unusedVariableRule.name,
        category: unusedVariableRule.category,
        severity: unusedVariableRule.defaultSeverity,
        confidence: unusedVariableRule.confidence,
        line,
        column: binding.identifier.loc.start.column,
        message: `Variable '${name}' is declared but never read or referenced.`,
        explanation: `The variable '${name}' is declared as a ${binding.kind} on line ${line}, but no subsequent statement in its scope reads its value. This adds unnecessary overhead and may indicate an incomplete calculation.`,
        suggestedFix: `Remove the declaration of '${name}' if it is not needed, or prefix with an underscore ('_${name}') if required.`,
        codeSnippet: context.lines[line - 1]?.trim(),
      });
    }
  }
}
