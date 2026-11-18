import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openProjectStore } from "../dist/storage/index.js";
import { applyPatch, previewPatch, recoverActions } from "../dist/edit/patch.js";

test("patches one current source span, records a diff, and preserves intervening edits", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-edit-"));
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  const root = path.join(home, "repo");
  fs.mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".env\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=yes\n");
  const file = path.join(root, "main.js");
  fs.writeFileSync(file, "export const answer = 1;\n");
  execFileSync("git", ["-C", root, "add", "main.js", ".gitignore"]);
  const opened = openProjectStore(root, home);
  try {
    const patch = { path: "main.js", oldText: "answer = 1", newText: "answer = 2" };
    const preview = previewPatch(root, patch);
    assert.match(preview.diff, /-answer = 1\n\+answer = 2/);
    fs.writeFileSync(file, "// user edit\nexport const answer = 1;\n");
    assert.throws(() => applyPatch(opened.db, root, patch, preview.beforeSha), /changed since patch preview/);
    assert.match(fs.readFileSync(file, "utf8"), /user edit/);
    const fresh = previewPatch(root, patch);
    const action = applyPatch(opened.db, root, patch, fresh.beforeSha);
    assert.equal(action.status, "completed");
    assert.equal(fs.readFileSync(file, "utf8"), "// user edit\nexport const answer = 2;\n");
    assert.equal(recoverActions(opened.db, root)[0].diff, fresh.diff);
    assert.throws(() => previewPatch(root, { ...patch, path: ".env" }), /ignored/);
    assert.throws(() => previewPatch(root, { ...patch, path: "../outside.js" }), /workspace/);
    assert.throws(() => previewPatch(root, { ...patch, oldText: "e" }), /exactly once/);
    opened.db.prepare("UPDATE tool_actions SET status = 'pending' WHERE id = ?").run(action.id);
    assert.equal(recoverActions(opened.db, root)[0].status, "completed");
  } finally { opened.db.close(); }
});
