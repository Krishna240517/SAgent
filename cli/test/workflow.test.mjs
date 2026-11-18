import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openProjectStore } from "../dist/storage/index.js";
import { detectChecks } from "../dist/edit/checks.js";
import { executeFix } from "../dist/edit/workflow.js";
import { sandboxAvailability } from "../dist/edit/sandbox.js";

function fixture(t, files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-fix-"));
  const root = path.join(home, "repo");
  fs.mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    execFileSync("git", ["-C", root, "add", name], { stdio: "ignore" });
  }
  const opened = openProjectStore(root, home);
  t.after(() => { opened.db.close(); assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  return { root, db: opened.db };
}

test("check detection selects repository scripts and language tools", (t) => {
  const { root } = fixture(t, {
    "web/package.json": JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc --noEmit" } }),
    "web/src/app.ts": "export const answer = 1;\n",
    "python/math.py": "answer = 1\n", "python/test_math.py": "from unittest import TestCase\n",
    "maven/pom.xml": "<project/>\n", "maven/App.java": "class App {}\n",
    "gradle/build.gradle": "plugins { id 'java' }\n", "gradle/App.java": "class App {}\n",
  });
  assert.deepEqual(detectChecks(root, "web/src/app.ts"), { directory: "web", focus: "", checks: ["npm:test", "npm:typecheck"] });
  assert.deepEqual(detectChecks(root, "python/math.py"), { directory: "python", focus: "test_math.py", checks: ["python:focused", "python:unittest"] });
  assert.deepEqual(detectChecks(root, "maven/App.java"), { directory: "maven", focus: "", checks: ["maven:test"] });
  assert.deepEqual(detectChecks(root, "gradle/App.java"), { directory: "gradle", focus: "", checks: ["gradle:test"] });
});

test("approval and failed checks gate completion and retain action logs", async (t) => {
  const { root, db } = fixture(t, { "math.js": "export const add = (a, b) => a - b;\n", "math.test.js": "import { test } from 'node:test';\n" });
  const patch = JSON.stringify({ path: "math.js", oldText: "a - b", newText: "a + b" });
  const propose = async () => patch;
  const availability = () => null;
  const verify = () => ({ status: "fail", exitCode: 1, output: "assertion failed" });
  const rejected = await executeFix(db, root, "fix add", propose, async () => false, verify, availability);
  assert.equal(rejected.status, "rejected");
  assert.match(fs.readFileSync(path.join(root, "math.js"), "utf8"), /a - b/);
  const failed = await executeFix(db, root, "fix add", propose, async () => true, verify, availability);
  assert.equal(failed.status, "failed");
  assert.equal(failed.checks[0].result.output, "assertion failed");
  assert.match(fs.readFileSync(path.join(root, "math.js"), "utf8"), /a \+ b/);
  const statuses = db.prepare("SELECT operation, status FROM tool_actions ORDER BY rowid").all();
  assert.ok(statuses.some((item) => item.operation === "approval" && item.status === "rejected"));
  assert.ok(statuses.some((item) => item.operation === "sandbox:node:focused" && item.status === "failed"));
});

for (const sample of [
  { language: "JavaScript", name: "math.js", before: "export const add = (a, b) => a - b;\n", oldText: "a - b", newText: "a + b",
    tests: { "math.test.js": "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.js';\ntest('add', () => assert.equal(add(2, 3), 5));\n" }, kind: "node:test" },
  { language: "TypeScript", name: "math.ts", before: "export const add = (a: number, b: number) => a - b;\n", oldText: "a - b", newText: "a + b",
    tests: { "math.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.ts';\ntest('add', () => assert.equal(add(2, 3), 5));\n" }, kind: "typescript:test" },
  { language: "Python", name: "maths.py", before: "def add(a, b):\n    return a - b\n", oldText: "a - b", newText: "a + b",
    tests: { "test_maths.py": "import unittest\nfrom maths import add\nclass MathTest(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n" }, kind: "python:unittest" },
  { language: "Java", name: "Maths.java", before: "class Maths { static int add(int a, int b) { return a +; } }\n", oldText: "a +;", newText: "a + b;",
    tests: { "MathsTest.java": "class MathsTest { static int value = Maths.add(2, 3); }\n" }, kind: "java:compile" },
]) test(`${sample.language} fixture completes an approved edit in Docker`, async (t) => {
  const unavailable = sandboxAvailability(sample.kind);
  if (unavailable) return t.skip(unavailable);
  const { root, db } = fixture(t, { [sample.name]: sample.before, ...sample.tests });
  const result = await executeFix(db, root, `fix ${sample.language} add`, async () => JSON.stringify({ path: sample.name, oldText: sample.oldText, newText: sample.newText }), async () => true);
  assert.equal(result.status, "verified", JSON.stringify(result.checks));
  assert.ok(result.checks.some((check) => check.kind === sample.kind));
  assert.match(fs.readFileSync(path.join(root, sample.name), "utf8"), /a \+ b/);
});
