import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { discoverWorkspace, safeSourceFile } from "../repo/workspace.js";

export type TextPatch = { path: string; oldText: string; newText: string };
export type ToolAction = { id: string; operation: string; path: string; before_sha: string; after_sha: string; diff: string; status: string; created_at: string; output: string };

function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }

export function previewPatch(root: string, patch: TextPatch) {
  if (!patch || typeof patch.path !== "string" || typeof patch.oldText !== "string" || typeof patch.newText !== "string" ||
      !patch.oldText || patch.oldText.length > 8_000 || !patch.newText || patch.newText.length > 8_000 ||
      patch.oldText === patch.newText || patch.oldText.includes("\0") || patch.newText.includes("\0")) {
    throw new Error("Patch must replace one nonempty source span of at most 8,000 characters.");
  }
  const relative = patch.path.replaceAll("\\", "/");
  if (!discoverWorkspace(root).files.includes(relative)) throw new Error("Patch path is ignored or outside the workspace.");
  const full = safeSourceFile(root, relative);
  if (fs.statSync(full).size > 1024 * 1024) throw new Error("File is too large to edit.");
  const before = fs.readFileSync(full, "utf8");
  if (before.includes("\0")) throw new Error("Binary files cannot be edited.");
  const start = before.indexOf(patch.oldText);
  if (start < 0 || before.indexOf(patch.oldText, start + 1) >= 0) throw new Error("Patch text must match exactly once; the file may have changed.");
  const after = before.slice(0, start) + patch.newText + before.slice(start + patch.oldText.length);
  const line = before.slice(0, start).split("\n").length;
  const lines = (value: string, marker: string) => value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").map((item) => `${marker}${item}`).join("\n");
  const diff = `--- a/${relative}\n+++ b/${relative}\n@@ ${line} @@\n${lines(patch.oldText, "-")}\n${lines(patch.newText, "+")}\n`;
  return { relative, full, beforeSha: digest(before), afterSha: digest(after), after, diff };
}

export function applyPatch(db: DatabaseSync, root: string, patch: TextPatch, expectedBeforeSha: string): ToolAction {
  const plan = previewPatch(root, patch);
  if (plan.beforeSha !== expectedBeforeSha) throw new Error("File changed since patch preview; review it again.");
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO tool_actions (id, operation, path, before_sha, after_sha, diff, status, created_at) VALUES (?, 'patch', ?, ?, ?, ?, 'pending', ?)")
    .run(id, plan.relative, plan.beforeSha, plan.afterSha, plan.diff, createdAt);
  const temporary = path.join(path.dirname(plan.full), `.${path.basename(plan.full)}.sagent-${id}.tmp`);
  try {
    const handle = fs.openSync(temporary, "wx", fs.statSync(plan.full).mode & 0o777);
    try { fs.writeFileSync(handle, plan.after, "utf8"); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    // shortcut: external editors can race this final hash check; add OS-level coordination if concurrent writers become common.
    if (digest(fs.readFileSync(plan.full, "utf8")) !== plan.beforeSha) throw new Error("File changed while applying patch.");
    fs.renameSync(temporary, plan.full);
    db.prepare("UPDATE tool_actions SET status = 'completed' WHERE id = ?").run(id);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    const current = fs.existsSync(plan.full) ? digest(fs.readFileSync(plan.full, "utf8")) : "";
    db.prepare("UPDATE tool_actions SET status = ? WHERE id = ?")
      .run(current === plan.afterSha ? "completed" : current === plan.beforeSha ? "failed" : "conflict", id);
    throw error;
  }
  return { id, operation: "patch", path: plan.relative, before_sha: plan.beforeSha, after_sha: plan.afterSha,
    diff: plan.diff, status: "completed", created_at: createdAt, output: "" };
}

export function recoverActions(db: DatabaseSync, root: string): ToolAction[] {
  const pending = db.prepare("SELECT * FROM tool_actions WHERE status = 'pending'").all() as ToolAction[];
  for (const action of pending) {
    let current = "";
    try { current = digest(fs.readFileSync(safeSourceFile(root, action.path), "utf8")); } catch { /* Missing or inaccessible files remain conflicts. */ }
    db.prepare("UPDATE tool_actions SET status = ? WHERE id = ?")
      .run(current === action.after_sha ? "completed" : current === action.before_sha ? "failed" : "conflict", action.id);
  }
  return db.prepare("SELECT * FROM tool_actions ORDER BY rowid DESC LIMIT 50").all() as ToolAction[];
}
