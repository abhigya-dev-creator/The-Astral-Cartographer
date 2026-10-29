import babelTraverse from '@babel/traverse';
import type { InspectionRule, RuleContext } from '../types.js';

const traverse: any =
  (babelTraverse as any).default?.default ||
  (babelTraverse as any).default ||
  babelTraverse;

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/ },
  { name: 'Stripe Secret Key', re: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'Private Key Header', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Bearer Token', re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i },
];

const SECRET_VAR_NAMES = /^(?:api_?key|auth_?token|secret_?key|client_?secret|private_?key|password|db_?pass)$/i;

const SQL_KEYWORDS = /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|FROM|WHERE)\b/i;

export const securityVulnerabilitiesRule: InspectionRule = {
  id: 'security-vulnerability',
  name: 'Security Vulnerability or Unsafe API Usage',
  category: 'security',
  defaultSeverity: 'error',
  confidence: 'confirmed',
  description: 'Detects dangerous functions like eval(), unsafe innerHTML assignments, hardcoded secrets, potential command injection, and unsanitized SQL queries.',
  check(context: RuleContext) {
    if (!context.ast) return;

    traverse(context.ast, {
      // 1. eval() and new Function()
      CallExpression(path: any) {
        const callee = path.node.callee;
        const line = path.node.loc?.start?.line || 0;

        if (callee.type === 'Identifier' && (callee.name === 'eval' || callee.name === 'execScript')) {
          context.addIssue({
            ruleId: securityVulnerabilitiesRule.id,
            ruleName: securityVulnerabilitiesRule.name,
            category: securityVulnerabilitiesRule.category,
            severity: 'error',
            confidence: 'confirmed',
            line,
            column: path.node.loc?.start?.column,
            message: `Use of dangerous '${callee.name}()' function.`,
            explanation: `'${callee.name}()' evaluates arbitrary string arguments as executable code. If influenced by user input or dynamic parameters, it permits arbitrary code execution (RCE) and disables JS engine performance optimizations.`,
            suggestedFix: "Refactor to use static functions, object lookups, or 'JSON.parse()' instead of evaluating dynamic code strings.",
            codeSnippet: context.lines[line - 1]?.trim(),
          });
        }

        // 2. Command injection via child_process.exec / execSync with concatenation
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          (callee.property.name === 'exec' || callee.property.name === 'execSync')
        ) {
          const firstArg = path.node.arguments[0];
          if (
            firstArg &&
            (firstArg.type === 'BinaryExpression' ||
              (firstArg.type === 'TemplateLiteral' && firstArg.expressions.length > 0))
          ) {
            context.addIssue({
              ruleId: securityVulnerabilitiesRule.id,
              ruleName: securityVulnerabilitiesRule.name,
              category: securityVulnerabilitiesRule.category,
              severity: 'warning',
              confidence: 'heuristic',
              line,
              column: path.node.loc?.start?.column,
              message: `Potential Command Injection: dynamic string passed to '${callee.property.name}()'.`,
              explanation: `Passing concatenated strings or template expressions directly to shell execution functions ('${callee.property.name}') permits shell metacharacters to inject arbitrary system commands.`,
              suggestedFix: "Use 'child_process.execFile()' or 'child_process.spawn()' with separate argument arrays instead of invoking a shell with raw concatenated strings.",
              codeSnippet: context.lines[line - 1]?.trim(),
            });
          }
        }

        // 3. SQL Injection via .query() / .execute() with string concatenation
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          (callee.property.name === 'query' || callee.property.name === 'execute')
        ) {
          const firstArg = path.node.arguments[0];
          if (firstArg?.type === 'BinaryExpression' && firstArg.operator === '+') {
            const codeSample = context.code.slice(firstArg.start, firstArg.end);
            if (SQL_KEYWORDS.test(codeSample)) {
              context.addIssue({
                ruleId: securityVulnerabilitiesRule.id,
                ruleName: securityVulnerabilitiesRule.name,
                category: securityVulnerabilitiesRule.category,
                severity: 'warning',
                confidence: 'heuristic',
                line,
                column: path.node.loc?.start?.column,
                message: "Potential SQL Injection: query assembled using string concatenation ('+').",
                explanation: 'Concatenating unescaped variables directly into database query strings allows attackers to alter query logic through SQL injection.',
                suggestedFix: "Use parameterized queries or prepared statements (e.g. 'db.query(\"SELECT ... WHERE id = $1\", [id])').",
                codeSnippet: context.lines[line - 1]?.trim(),
              });
            }
          }
        }
      },

      // 4. new Function(...)
      NewExpression(path: any) {
        const callee = path.node.callee;
        const line = path.node.loc?.start?.line || 0;

        if (callee.type === 'Identifier' && callee.name === 'Function') {
          context.addIssue({
            ruleId: securityVulnerabilitiesRule.id,
            ruleName: securityVulnerabilitiesRule.name,
            category: securityVulnerabilitiesRule.category,
            severity: 'error',
            confidence: 'confirmed',
            line,
            column: path.node.loc?.start?.column,
            message: "Use of 'new Function()' constructor to execute dynamic code.",
            explanation: "'new Function()' dynamically compiles and executes string code in the global scope, presenting security risks equivalent to 'eval()'.",
            suggestedFix: 'Replace dynamic function construction with standard modular functions or pre-defined callbacks.',
            codeSnippet: context.lines[line - 1]?.trim(),
          });
        }
      },

      // 5. Unsafe innerHTML assignment
      AssignmentExpression(path: any) {
        const left = path.node.left;
        const right = path.node.right;
        const line = path.node.loc?.start?.line || 0;

        if (left.type === 'MemberExpression' && left.property.type === 'Identifier') {
          const prop = left.property.name;
          if (prop === 'innerHTML' || prop === 'outerHTML') {
            // Only flag if right-hand side is not a simple static string literal
            if (right.type !== 'StringLiteral') {
              context.addIssue({
                ruleId: securityVulnerabilitiesRule.id,
                ruleName: securityVulnerabilitiesRule.name,
                category: securityVulnerabilitiesRule.category,
                severity: 'warning',
                confidence: 'heuristic',
                line,
                column: path.node.loc?.start?.column,
                message: `Potential Cross-Site Scripting (XSS): dynamic content assigned to '${prop}'.`,
                explanation: `Assigning unescaped dynamic strings directly to '${prop}' allows injected HTML markup and script tags to execute in the browser.`,
                suggestedFix: "Use 'textContent' or 'innerText', or sanitize dynamic HTML with a library like DOMPurify prior to insertion.",
                codeSnippet: context.lines[line - 1]?.trim(),
              });
            }
          }
        }
      },

      // 6. JSX dangerouslySetInnerHTML
      JSXAttribute(path: any) {
        const name = path.node.name?.name;
        const line = path.node.loc?.start?.line || 0;
        if (name === 'dangerouslySetInnerHTML') {
          context.addIssue({
            ruleId: securityVulnerabilitiesRule.id,
            ruleName: securityVulnerabilitiesRule.name,
            category: securityVulnerabilitiesRule.category,
            severity: 'warning',
            confidence: 'heuristic',
            line,
            column: path.node.loc?.start?.column,
            message: "Usage of 'dangerouslySetInnerHTML' in JSX component.",
            explanation: "'dangerouslySetInnerHTML' bypasses React's default HTML escaping protections and can introduce XSS vulnerabilities if the input contains unsanitized user content.",
            suggestedFix: 'Ensure content passed to dangerouslySetInnerHTML is thoroughly sanitized with DOMPurify.',
            codeSnippet: context.lines[line - 1]?.trim(),
          });
        }
      },

      // 7. Hardcoded Secrets
      StringLiteral(path: any) {
        const val = path.node.value;
        const line = path.node.loc?.start?.line || 0;
        if (typeof val !== 'string' || val.length < 12) return;

        // Skip obvious generic placeholders
        if (val === 'YOUR_API_KEY_HERE' || val === 'PLACEHOLDER_TOKEN') return;

        for (const pattern of SECRET_PATTERNS) {
          if (pattern.re.test(val)) {
            context.addIssue({
              ruleId: securityVulnerabilitiesRule.id,
              ruleName: securityVulnerabilitiesRule.name,
              category: securityVulnerabilitiesRule.category,
              severity: 'error',
              confidence: 'confirmed',
              line,
              column: path.node.loc?.start?.column,
              message: `Potential hardcoded credential detected (${pattern.name}).`,
              explanation: `A string matching the format of a ${pattern.name} was discovered embedded in the source code. Storing credentials in repository code risks leakage.`,
              suggestedFix: "Extract this secret into an environment variable (e.g. process.env.SECRET) and remove it from source control.",
              codeSnippet: context.lines[line - 1]?.replace(val, '***REDACTED***')?.trim(),
            });
            return;
          }
        }

        // Variable name check: const apiKey = "some-long-string-12345"
        const parent = path.parent;
        if (
          parent?.type === 'VariableDeclarator' &&
          parent.id?.type === 'Identifier' &&
          SECRET_VAR_NAMES.test(parent.id.name) &&
          val.length >= 16 &&
          !val.startsWith('http://') &&
          !val.startsWith('https://')
        ) {
          context.addIssue({
            ruleId: securityVulnerabilitiesRule.id,
            ruleName: securityVulnerabilitiesRule.name,
            category: securityVulnerabilitiesRule.category,
            severity: 'warning',
            confidence: 'heuristic',
            line,
            column: path.node.loc?.start?.column,
            message: `Potential hardcoded secret assigned to variable '${parent.id.name}'.`,
            explanation: `The variable name '${parent.id.name}' indicates a credential or token, and it is initialized with a raw static string literal.`,
            suggestedFix: `Load '${parent.id.name}' from an environment variable (e.g. 'process.env.${parent.id.name.toUpperCase()}') instead of hardcoding it.`,
            codeSnippet: context.lines[line - 1]?.replace(val, '***REDACTED***')?.trim(),
          });
        }
      },
    });
  },
};
