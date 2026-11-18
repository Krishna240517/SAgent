import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";
import type { ProjectLink } from "./records.js";
import { workspaceRoot } from "../repo/workspace.js";

function openDatabase(file: string, kind: "global" | "project"): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(file, "a", 0o600));
  fs.chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON");
    migrate(db, kind);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openGlobalStore(root = path.join(os.homedir(), ".sagent")): DatabaseSync {
  return openDatabase(path.join(root, "global.sqlite"), "global");
}

function canonicalPath(projectPath: string): string {
  const resolved = workspaceRoot(projectPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function gitRemote(projectPath: string): string | null {
  try {
    const remote = execFileSync("git", ["-C", projectPath, "config", "--get", "remote.origin.url"], {
      encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!remote) return null;
    if (/^https?:\/\//i.test(remote)) {
      const url = new URL(remote);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    return remote;
  } catch {
    return null;
  }
}

export function openProjectStore(
  projectPath = process.cwd(),
  root = path.join(os.homedir(), ".sagent"),
): { db: DatabaseSync; link: ProjectLink } {
  const localPath = canonicalPath(projectPath);
  const remoteUrl = gitRemote(localPath);
  const global = openGlobalStore(root);
  let link: ProjectLink;
  try {
    link = global.prepare(`INSERT INTO project_links (project_id, local_path, remote_url, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(local_path) DO UPDATE SET remote_url = excluded.remote_url
      RETURNING *`).get(randomUUID(), localPath, remoteUrl, new Date().toISOString()) as ProjectLink;
  } finally {
    global.close();
  }
  return { db: openDatabase(path.join(root, "projects", link.project_id, "state.sqlite"), "project"), link };
}

export function linkProject(projectPath: string, projectId: string, root = path.join(os.homedir(), ".sagent")): ProjectLink {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) throw new Error("Invalid project ID.");
  const localPath = canonicalPath(projectPath);
  const remoteUrl = gitRemote(localPath);
  const global = openGlobalStore(root);
  try {
    const current = global.prepare("SELECT * FROM project_links WHERE local_path = ?").get(localPath) as ProjectLink | undefined;
    if (current && current.project_id !== projectId) {
      const file = path.join(root, "projects", current.project_id, "state.sqlite");
      if (fs.existsSync(file)) {
        const db = openDatabase(file, "project");
        try {
          for (const table of ["conversations", "messages", "decisions", "tasks", "accepted_preferences", "summaries", "sync_outbox", "sync_conflicts"]) {
            if ((db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count) {
              throw new Error("This checkout has project history. Export or preserve it before linking a different ID.");
            }
          }
        } finally { db.close(); }
      }
    }
    const target = global.prepare("SELECT * FROM project_links WHERE project_id = ?").get(projectId) as ProjectLink | undefined;
    if (target && target.local_path !== localPath && fs.existsSync(target.local_path)) {
      throw new Error("That project ID is already linked to an existing checkout on this machine.");
    }
    global.exec("BEGIN IMMEDIATE");
    try {
      if (current && current.project_id !== projectId) global.prepare("DELETE FROM project_links WHERE local_path = ?").run(localPath);
      if (target) global.prepare("UPDATE project_links SET local_path = ?, remote_url = ? WHERE project_id = ?").run(localPath, remoteUrl, projectId);
      else global.prepare("INSERT INTO project_links VALUES (?, ?, ?, ?)").run(projectId, localPath, remoteUrl, new Date().toISOString());
      global.exec("COMMIT");
    } catch (error) { global.exec("ROLLBACK"); throw error; }
    return global.prepare("SELECT * FROM project_links WHERE project_id = ?").get(projectId) as ProjectLink;
  } finally { global.close(); }
}
