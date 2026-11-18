import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverWorkspace, requireRevision, safeSourceFile } from "../dist/repo/workspace.js";
import { readRange } from "../dist/repo/tools.js";
import { linkProject, openProjectStore } from "../dist/storage/index.js";

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-repo-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("workspace inventory respects Git ignores and rejects secret or escaping reads", (t) => {
  const root = temp(t);
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.py\n.env\n");
  fs.writeFileSync(path.join(repo, "src", "main.ts"), "export function run() {}\n");
  fs.writeFileSync(path.join(repo, "src", "extra.java"), "class Extra {}\n");
  fs.writeFileSync(path.join(repo, "ignored.py"), "secret\n");
  fs.writeFileSync(path.join(repo, ".env"), "SECRET=value\n");
  fs.mkdirSync(path.join(repo, ".aws"));
  fs.writeFileSync(path.join(repo, ".aws", "credentials"), "secret\n");
  fs.writeFileSync(path.join(repo, "package.json"), "{}\n");
  execFileSync("git", ["-C", repo, "add", ".gitignore", "src/main.ts", "package.json"]);
  const info = discoverWorkspace(path.join(repo, "src"));
  assert.deepEqual(
    [fs.statSync(info.root).dev, fs.statSync(info.root).ino],
    [fs.statSync(repo).dev, fs.statSync(repo).ino],
  );
  assert.ok(info.trackedFiles.includes("src/main.ts"));
  assert.ok(info.untrackedFiles.includes("src/extra.java"));
  assert.ok(!info.files.includes("ignored.py") && !info.files.includes(".env") && !info.files.includes(".aws/credentials"));
  assert.equal(info.languageMix.TypeScript, 1);
  assert.equal(info.languageMix.Java, 1);
  assert.ok(info.buildFiles.includes("package.json"));
  assert.ok(info.ignoreFiles.includes(".gitignore"));
  assert.equal(safeSourceFile(info.root, "src/main.ts"), fs.realpathSync(path.join(repo, "src/main.ts")));
  assert.throws(() => safeSourceFile(info.root, ".env"), /excluded/);
  assert.throws(() => safeSourceFile(info.root, ".aws/credentials"), /outside/);
  assert.throws(() => safeSourceFile(info.root, "../outside.txt"), /outside/);
  const outside = path.join(root, "outside.ts");
  fs.writeFileSync(outside, "export const secret = 1;\n");
  try {
    fs.symlinkSync(outside, path.join(repo, "src", "escape.ts"));
    assert.throws(() => safeSourceFile(info.root, "src/escape.ts"), /outside/);
    fs.symlinkSync(path.join(repo, ".env"), path.join(repo, "src", "alias.ts"));
    assert.throws(() => safeSourceFile(info.root, "src/alias.ts"), /excluded/);
    assert.ok(!discoverWorkspace(repo).files.includes("src/alias.ts"));
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
  assert.throws(() => requireRevision(repo, "wrong"), /mismatch/);
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture"]);
  requireRevision(repo, discoverWorkspace(repo).revision);
});

test("project ID links another checkout and preserves existing project history", (t) => {
  const root = temp(t);
  const homeA = path.join(root, "a");
  const homeB = path.join(root, "b");
  const checkoutA = path.join(root, "checkout-a");
  const checkoutB = path.join(root, "checkout-b");
  fs.mkdirSync(checkoutA);
  fs.mkdirSync(checkoutB);
  for (const checkout of [checkoutA, checkoutB]) {
    execFileSync("git", ["init", "-q", checkout]);
    execFileSync("git", ["-C", checkout, "remote", "add", "origin", "https://example.com/team/repo.git"]);
  }
  const first = openProjectStore(checkoutA, homeA);
  const id = first.link.project_id;
  first.db.close();
  const second = openProjectStore(checkoutB, homeB);
  second.db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?)").run("existing", "Keep me", "now", "now");
  second.db.close();
  assert.throws(() => linkProject(checkoutB, id, homeB), /project history/);
  const existing = openProjectStore(checkoutB, homeB);
  assert.equal(existing.db.prepare("SELECT title FROM conversations WHERE id = 'existing'").get().title, "Keep me");
  existing.db.prepare("DELETE FROM conversations").run();
  existing.db.close();
  assert.equal(linkProject(checkoutB, id, homeB).project_id, id);
  const linked = openProjectStore(checkoutB, homeB);
  assert.equal(linked.link.project_id, id);
  linked.db.close();
});

test("a directory without Git still honors ignore rules", (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".env\nignored.py\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=value\n");
  fs.writeFileSync(path.join(root, "ignored.py"), "hidden\n");
  fs.writeFileSync(path.join(root, "src", "visible.py"), "def visible(): pass\n");
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const info = discoverWorkspace(root);
    assert.equal(info.isGit, false);
    assert.ok(info.files.includes("src/visible.py"));
    assert.ok(!info.files.includes("ignored.py") && !info.files.includes(".env"));
    assert.equal(readRange(root, "src/visible.py", 1, 1)[0].text, "def visible(): pass");
  } finally { process.env.PATH = originalPath; }
});
