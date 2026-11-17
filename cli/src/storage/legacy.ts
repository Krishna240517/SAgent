import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function filesUnder(directory: string, prefix = ""): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return filesUnder(path.join(directory, entry.name), relative);
    if (!entry.isFile()) throw new Error(`Legacy database contains a non-file entry: ${relative}`);
    return [relative];
  }).sort();
}

function digest(file: string): string {
  const hash = createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size: number;
    while ((size = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

export function backupLegacyPGlite(root = path.join(os.homedir(), ".sagent")) {
  const sources = [path.join(root, "auth", "data")];
  const projects = path.join(root, "projects");
  if (fs.existsSync(projects)) {
    for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
      if (entry.isDirectory()) sources.push(path.join(projects, entry.name, "data"));
    }
  }
  const existing = sources.filter((source) => fs.existsSync(source));
  if (existing.length === 0) return { backupPath: null, filesVerified: 0 };

  const backupPath = path.join(root, "backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  let filesVerified = 0;
  for (const source of existing) {
    const relative = path.relative(root, source);
    const target = path.join(backupPath, relative);
    const originalFiles = filesUnder(source);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    const copiedFiles = filesUnder(target);
    if (JSON.stringify(originalFiles) !== JSON.stringify(copiedFiles)) throw new Error(`Backup file list differs: ${relative}`);
    for (const file of originalFiles) {
      if (digest(path.join(source, file)) !== digest(path.join(target, file))) throw new Error(`Backup checksum differs: ${relative}/${file}`);
      filesVerified++;
    }
  }
  return { backupPath, filesVerified };
}
