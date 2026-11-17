import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";
import type { ProjectLink } from "./records.js";

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
  let root = projectPath;
  try {
    root = execFileSync("git", ["-C", projectPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // A directory without Git is still a valid local project.
  }
  const resolved = fs.realpathSync(root);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
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
  // shortcut: checkout moves require explicit relinking, add it with cross-machine sync in Phase 2.
  return { db: openDatabase(path.join(root, "projects", link.project_id, "state.sqlite"), "project"), link };
}
