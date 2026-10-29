import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSourceCode } from '../services/analysis/codeInspection/index.js';

test('code inspection: unreachable code after return', () => {
  const code = `
function calculate(x: number) {
  return x * 2;
  const dead = x + 10;
  console.log(dead);
}
`;
  const result = inspectSourceCode(code, 'src/math.ts');
  const issue = result.issues.find((i) => i.ruleId === 'unreachable-code');
  assert.ok(issue, 'Should detect unreachable code');
  assert.equal(issue.severity, 'error');
  assert.equal(issue.confidence, 'confirmed');
  assert.equal(issue.line, 4);
});

test('code inspection: unused local variable', () => {
  const code = `
function demo() {
  const unusedVal = 42;
  const usedVal = 10;
  const _ignoredVal = 99;
  return usedVal * 2;
}
`;
  const result = inspectSourceCode(code, 'src/demo.ts');
  const unusedIssues = result.issues.filter((i) => i.ruleId === 'unused-variable');
  assert.equal(unusedIssues.length, 1);
  assert.ok(unusedIssues[0].message.includes('unusedVal'));
});

test('code inspection: division by literal zero and zero variable', () => {
  const code = `
function divide(a: number) {
  const zero = 0;
  const res1 = a / 0;
  const res2 = a % 0;
  const res3 = a / zero;
  return res1 + res2 + res3;
}
`;
  const result = inspectSourceCode(code, 'src/calc.ts');
  const divIssues = result.issues.filter((i) => i.ruleId === 'division-by-zero');
  assert.ok(divIssues.length >= 2, 'Should detect division by 0');
  assert.ok(divIssues.some((i) => i.line === 4 && i.severity === 'error'));
});

test('code inspection: infinite loop detection and inverted counter', () => {
  const code = `
function run() {
  while (true) {
    console.log("running");
  }

  for (let i = 0; i < 10; i--) {
    console.log(i);
  }
}
`;
  const result = inspectSourceCode(code, 'src/loop.ts');
  const loopIssues = result.issues.filter((i) => i.ruleId === 'suspicious-loop');
  assert.equal(loopIssues.length, 2, 'Should detect while(true) and inverted loop counter');
  assert.ok(loopIssues.some((i) => i.message.includes('Infinite loop')));
  assert.ok(loopIssues.some((i) => i.message.includes('decrements')));
});

test('code inspection: self comparison and duplicate else-if condition', () => {
  const code = `
function check(x: number, y: number) {
  if (x === x) {
    console.log("self comparison");
  }
  if (x > 5) {
    return 1;
  } else if (x > 5) {
    return 2;
  }
}
`;
  const result = inspectSourceCode(code, 'src/logic.ts');
  const logicIssues = result.issues.filter((i) => i.ruleId === 'logical-error');
  assert.ok(logicIssues.some((i) => i.message.includes('Self-comparison')));
  assert.ok(logicIssues.some((i) => i.message.includes('Duplicate condition')));
});

test('code inspection: security vulnerabilities (eval, innerHTML, hardcoded key)', () => {
  const code = `
function runUnsafe(codeStr: string, dynamicHtml: string) {
  eval(codeStr);
  document.getElementById("box")!.innerHTML = dynamicHtml;
  const awsKey = "AKIAIOSFODNN7EXAMPLE";
}
`;
  const result = inspectSourceCode(code, 'src/sec.ts');
  const secIssues = result.issues.filter((i) => i.category === 'security');
  assert.ok(secIssues.some((i) => i.message.includes('eval()')));
  assert.ok(secIssues.some((i) => i.message.includes('innerHTML')));
  assert.ok(secIssues.some((i) => i.message.includes('AWS Access Key')));
});

test('code inspection: valid code does not trigger false positives', () => {
  const validCode = `
import React from 'react';

export function ValidComponent({ title }: { title: string }) {
  const [count] = React.useState(0);
  
  for (let i = 0; i < 10; i++) {
    console.log(i);
  }

  while (count < 5) {
    break;
  }

  const denominator = 2;
  const ratio = count / denominator;

  return <div>{title}: {ratio}</div>;
}
`;
  const result = inspectSourceCode(validCode, 'src/Valid.tsx');
  assert.equal(result.issues.length, 0, 'Clean code should have 0 issues');
});
