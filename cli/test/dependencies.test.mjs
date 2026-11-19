import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { dependencyImage, prepareDependencies } from "../dist/edit/dependencies.js";

test("dependency cache follows manifests, keeps source edits reusable, and requires approval", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-deps-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"test"}');
  fs.writeFileSync(path.join(root, "app.js"), "console.log(1)");
  const first = dependencyImage(root, "", "npm");
  fs.writeFileSync(path.join(root, "app.js"), "console.log(2)");
  assert.equal(dependencyImage(root, "", "npm"), first);
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"test","version":"2"}');
  assert.notEqual(dependencyImage(root, "", "npm"), first);
  assert.throws(() => dependencyImage(root, "..", "npm"), /Invalid/);
  assert.throws(() => prepareDependencies(root, "", "npm", false), /approval/);
});
