import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSandbox } from "../dist/edit/sandbox.js";

test("Docker runs only a source snapshot and stops overlong checks", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-sandbox-test-"));
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  const root = path.join(home, "repo");
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".env\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=never-copy\n");
  const file = path.join(root, "test", "sandbox.test.js");
  fs.writeFileSync(file, `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
test('isolated', () => {
  assert.equal(process.getuid(), 65532);
  assert.deepEqual(Object.keys(os.networkInterfaces()), ['lo']);
  assert.equal(fs.existsSync('/work/.env'), false);
  assert.equal(fs.existsSync('/var/run/docker.sock'), false);
  assert.throws(() => fs.writeFileSync('/input/test/sandbox.test.js', 'escape'));
});\n`);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  execFileSync("git", ["-C", root, "add", ".gitignore", "test/sandbox.test.js"]);
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try { assert.equal(runSandbox(root, "node:test").status, "unavailable"); }
  finally { process.env.PATH = originalPath; }
  const first = runSandbox(root, "node:test", 30_000);
  if (first.status === "unavailable") return t.skip(first.output);
  assert.equal(first.status, "pass", first.output);
  assert.match(first.output, /pass 1/);
  assert.match(fs.readFileSync(file, "utf8"), /test\('isolated'/);
  fs.writeFileSync(file, "while (true) {}\n");
  const timed = runSandbox(root, "node:test", 3_000);
  if (timed.status === "unavailable") return t.skip(timed.output);
  assert.equal(timed.status, "timeout", timed.output);
  assert.throws(() => runSandbox(root, "host_shell"), /Unsupported sandbox check/);
});
