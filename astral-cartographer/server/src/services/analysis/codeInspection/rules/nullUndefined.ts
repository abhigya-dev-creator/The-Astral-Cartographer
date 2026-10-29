import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

const NULLABLE_METHODS = new Set([
  'find',
  'getElementById',
  'querySelector',
  'getItem',
  'match',
  'exec',
]);

export const nullUndefinedAccessRule: InspectionRule = {
  id: 'potential-null-dereference',
  name: 'Potential Null or Undefined Property Access',
  category: 'null_undefined',
  defaultSeverity: 'warning',
  confidence: 'heuristic',
  description: 'Detects property or method access on expressions or variables that can return or contain null or undefined without prior validation.',
  check(context: RuleContext) {
    if (!context.ast) return;

    // Track variable names assigned from known nullable returning methods in the same scope
    const nullableVarBindings = new Map<string, { line: number; method: string }>();

    traverse(context.ast, {
      // 1. Variable initialized directly to null or undefined
      VariableDeclarator(path: any) {
        const id = path.node.id;
        const init = path.node.init;
        if (id?.type === 'Identifier' && init) {
          if (
            init.type === 'NullLiteral' ||
            (init.type === 'Identifier' && init.name === 'undefined')
          ) {
            nullableVarBindings.set(id.name, {
              line: id.loc?.start?.line || 0,
              method: init.type === 'NullLiteral' ? 'null literal' : 'undefined',
            });
          } else if (init.type === 'CallExpression') {
            const callee = init.callee;
            if (
              callee.type === 'MemberExpression' &&
              callee.property.type === 'Identifier' &&
              NULLABLE_METHODS.has(callee.property.name)
            ) {
              nullableVarBindings.set(id.name, {
                line: id.loc?.start?.line || 0,
                method: callee.property.name,
              });
            }
          }
        }
      },

      // 2. Direct property access on a nullable method result, e.g. arr.find(...).prop without ?.
      MemberExpression(path: any) {
        const node = path.node;
        if (node.optional) return; // uses ?. safely

        // Case A: chained immediately on nullable call, e.g. `arr.find(...).name`
        if (node.object?.type === 'CallExpression') {
          const callee = node.object.callee;
          if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            NULLABLE_METHODS.has(callee.property.name)
          ) {
            const line = node.loc?.start?.line || callee.loc?.start?.line || 0;
            const propName = node.property.type === 'Identifier' ? node.property.name : 'property';
            context.addIssue({
              ruleId: nullUndefinedAccessRule.id,
              ruleName: nullUndefinedAccessRule.name,
              category: nullUndefinedAccessRule.category,
              severity: nullUndefinedAccessRule.defaultSeverity,
              confidence: 'heuristic',
              line,
              column: node.loc?.start?.column,
              message: `Unguarded access to '.${propName}' on method '${callee.property.name}()' which can return null or undefined.`,
              explanation: `The method '${callee.property.name}()' returns undefined or null when no matching element is found. Accessing '.${propName}' directly without checking will throw a TypeError at runtime.`,
              suggestedFix: `Use optional chaining ('?.${propName}') or check that the result is non-null before accessing its properties.`,
              codeSnippet: context.lines[line - 1]?.trim(),
            });
            return;
          }
        }

        // Case B: variable assigned from nullable source accessed without check or optional chaining
        if (node.object?.type === 'Identifier') {
          const varName = node.object.name;
          const binding = nullableVarBindings.get(varName);
          if (binding && node.loc?.start?.line && node.loc.start.line > binding.line) {
            // Check if inside an `if (varName)` guard or logical guard
            const parentIf = path.findParent((p: any) => p.isIfStatement() || p.isLogicalExpression());
            if (!parentIf) {
              const line = node.loc.start.line;
              const propName = node.property.type === 'Identifier' ? node.property.name : 'property';
              context.addIssue({
                ruleId: nullUndefinedAccessRule.id,
                ruleName: nullUndefinedAccessRule.name,
                category: nullUndefinedAccessRule.category,
                severity: nullUndefinedAccessRule.defaultSeverity,
                confidence: 'heuristic',
                line,
                column: node.loc.start.column,
                message: `Variable '${varName}' (initialized from ${binding.method} on line ${binding.line}) accessed as '.${propName}' without null check.`,
                explanation: `'${varName}' may be null or undefined. Accessing properties on it without checking or optional chaining can trigger an unhandled TypeError.`,
                suggestedFix: `Use optional chaining ('${varName}?.${propName}') or verify '${varName} !== null' prior to access.`,
                codeSnippet: context.lines[line - 1]?.trim(),
              });
              // Remove to avoid duplicate reports for the same variable
              nullableVarBindings.delete(varName);
            }
          }
        }
      },
    });
  },
};
