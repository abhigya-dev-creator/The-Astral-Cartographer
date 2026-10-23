import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAtlas } from '../services/atlas/analyzeAtlas.js';
import { scrubJava } from '../services/atlas/javaDeps.js';
import type { AtlasData } from '../services/atlas/types.js';

const REPO = { owner: 'test', name: 'java', branch: 'main', commitSha: 'b'.repeat(40), analyzedAt: '2026-01-01T00:00:00.000Z' };
const J = 'src/main/java/com/acme';

function atlas(files: Record<string, string>): AtlasData {
  return analyzeAtlas({ repo: REPO, files: Object.entries(files).map(([path, text]) => ({ path, text })) });
}
const edgesFrom = (a: AtlasData, from: string) => a.edges.filter((e) => e.from === `${J}/${from}`).map((e) => [e.specifier, e.status, e.to?.slice(J.length + 1) ?? e.reason, e.line]);

const files = {
  [`${J}/Application.java`]: `package com.acme;

import org.springframework.boot.SpringApplication;

public class Application {
  public static void main(String[] args) { SpringApplication.run(Application.class, args); }
}
`,
  [`${J}/web/UserController.java`]: `package com.acme.web;

import com.acme.service.UserService;
import com.acme.model.*;
import static com.acme.util.Strings.trim;
import com.acme.generated.ApiDto;
import java.util.List;
// import com.acme.service.Unused;  (a comment, not an import)

@RestController
public class UserController {
  private final UserService users;
  String s = "import com.acme.model.Order;";
  List<User> all() { return users.findAll(); }
  ErrorBody fail() { return new ErrorBody(); }
}
`,
  [`${J}/web/ErrorBody.java`]: `package com.acme.web;\n\npublic record ErrorBody(String message) {}\n`,
  [`${J}/service/UserService.java`]: `package com.acme.service;

import com.acme.model.User;
import com.acme.model.User.Role;

public interface UserService { java.util.List<User> findAll(); }
`,
  [`${J}/model/User.java`]: `package com.acme.model;\n\npublic class User { public enum Role { ADMIN } }\n`,
  [`${J}/model/Order.java`]: `package com.acme.model;\n\npublic class Order {}\n`,
  [`${J}/util/Strings.java`]: `package com.acme.util;\n\npublic final class Strings { public static String trim(String s) { return s.trim(); } }\n`,
  'pom.xml': '<project/>',
};

test('Java: explicit, static, wildcard and same-package dependencies resolve to repository files', () => {
  const a = atlas(files);
  assert.deepEqual(edgesFrom(a, 'web/UserController.java'), [
    ['com.acme.service.UserService', 'resolved', 'service/UserService.java', 3],
    // wildcard: only the class actually used (User), not Order
    ['com.acme.model.*', 'resolved', 'model/User.java', 4],
    ['static com.acme.util.Strings.trim', 'resolved', 'util/Strings.java', 5],
    ['com.acme.generated.ApiDto', 'unresolved', 'class not found in repository (generated?)', 6],
    ['java.util.List', 'external', 'built-in module', 7],
    // same package: no import statement, linked at the first use
    ['com.acme.web.ErrorBody', 'resolved', 'web/ErrorBody.java', 15],
  ]);
  // a nested-class import resolves to the file of its outer class, once
  assert.deepEqual(edgesFrom(a, 'service/UserService.java'), [['com.acme.model.User', 'resolved', 'model/User.java', 3]]);
  assert.deepEqual(edgesFrom(a, 'Application.java'), [['org.springframework.boot.SpringApplication', 'external', 'package', 3]]);
  const ctl = a.files.find((f) => f.path === `${J}/web/UserController.java`)!;
  assert.equal(ctl.kind, 'code');
  assert.deepEqual(ctl.functions, [{ name: 'UserController', line: 11, kind: 'class' }]);
  assert.equal(a.files.find((f) => f.path === 'pom.xml')!.kind, 'other');
  assert.equal(a.stats.unresolved, 1);
});

test('Java: cycles are detected across packages', () => {
  const a = atlas({
    'src/a/A.java': 'package a;\nimport b.B;\nclass A { B b; }\n',
    'src/b/B.java': 'package b;\nimport a.A;\nclass B { A a; }\n',
  });
  assert.deepEqual(a.cycles, [['src/a/A.java', 'src/b/B.java']]);
});

test('Java scrubber blanks comments and literals but keeps line numbers', () => {
  const src = 'a /* x\ny */ "s//t" \'c\' """\ntext\n""" // end\nb';
  const out = scrubJava(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.deepEqual(out.replace(/\s+/g, ' ').trim(), 'a b');
});
