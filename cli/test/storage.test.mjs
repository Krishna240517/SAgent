import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { openGlobalStore, openProjectStore } from "../dist/storage/index.js";
import { backupLegacyPGlite } from "../dist/storage/legacy.js";

function withTemp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("versioned SQLite stores preserve data and project ID on reopen", (t) => {
  const root = withTemp(t);
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(checkout);
  const first = openProjectStore(checkout, root);
  try {
    assert.equal(first.db.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(fs.existsSync(path.join(root, "projects", first.link.project_id, "state.sqlite")), true);
    first.db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?)").run("c1", "test", "now", "now");
    assert.throws(() => first.db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)").run("m1", "missing", "user", "text", "now"), /FOREIGN KEY/);
  } finally {
    first.db.close();
  }
  const second = openProjectStore(checkout, root);
  try {
    assert.equal(second.link.project_id, first.link.project_id);
    assert.equal(second.db.prepare("SELECT title FROM conversations WHERE id = ?").get("c1").title, "test");
    assert.equal(second.link.remote_url, null);
  } finally {
    second.db.close();
  }
  const global = openGlobalStore(root);
  try {
    assert.equal(global.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(fs.existsSync(path.join(root, "global.sqlite")), true);
    global.exec("PRAGMA user_version = 3");
  } finally {
    global.close();
  }
  assert.throws(() => openGlobalStore(root), /newer than this SAgent CLI/);
});

test("legacy backup verifies copies and leaves the original intact", (t) => {
  const root = withTemp(t);
  const source = path.join(root, "auth", "data");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "fixture.bin"), "legacy-data");
  const result = backupLegacyPGlite(root);
  assert.equal(result.filesVerified, 1);
  assert.equal(fs.readFileSync(path.join(result.backupPath, "auth", "data", "fixture.bin"), "utf8"), "legacy-data");
  assert.equal(fs.readFileSync(path.join(source, "fixture.bin"), "utf8"), "legacy-data");
});

test("a second startup cannot migrate through another writer's lock", (t) => {
  const root = withTemp(t);
  const first = openGlobalStore(root);
  first.exec("BEGIN IMMEDIATE");
  try {
    assert.throws(() => openGlobalStore(root), /locked|busy/i);
  } finally {
    first.exec("ROLLBACK");
    first.close();
  }
  const reopened = openGlobalStore(root);
  reopened.close();
});

test("nested directories in one Git checkout reuse the project ID", (t) => {
  const root = withTemp(t);
  const checkout = path.join(root, "checkout");
  const nested = path.join(checkout, "src");
  fs.mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", checkout]);
  const first = openProjectStore(checkout, root);
  const second = openProjectStore(nested, root);
  assert.equal(second.link.project_id, first.link.project_id);
  first.db.close();
  second.db.close();
});

test("a changed Git remote updates its hint without changing project identity", (t) => {
  const root = withTemp(t);
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(checkout);
  execFileSync("git", ["init", "-q", checkout]);
  execFileSync("git", ["-C", checkout, "remote", "add", "origin", "https://user:secret@example.com/team/one.git?token=hidden#fragment"]);
  const first = openProjectStore(checkout, root);
  first.db.close();
  execFileSync("git", ["-C", checkout, "remote", "set-url", "origin", "https://example.com/team/two.git"]);
  const second = openProjectStore(checkout, root);
  assert.equal(first.link.project_id, second.link.project_id);
  assert.equal(first.link.remote_url, "https://example.com/team/one.git");
  assert.equal(second.link.remote_url, "https://example.com/team/two.git");
  second.db.close();
});

test("help and version need no database or auth server", (t) => {
  const home = withTemp(t);
  for (const args of [[], ["--help"], ["--version"]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url)), ...args], {
      encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(fs.existsSync(path.join(home, ".sagent")), false);
});
