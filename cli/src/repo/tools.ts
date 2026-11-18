import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { discoverWorkspace, safeSourceFile } from "./workspace.js";

export type SourceLine = { path: string; line: number; text: string };

function files(root: string) { return discoverWorkspace(root).files; }

export function globFiles(root: string, pattern: string, limit = 100): string[] {
  if (!pattern || pattern.length > 256) throw new Error("Glob must be 1–256 characters.");
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      source += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
  }
  const regex = new RegExp(source + "$", process.platform === "win32" ? "i" : "");
  return files(root).filter((file) => regex.test(file.replaceAll("\\", "/"))).slice(0, Math.min(limit, 500));
}

export function readRange(root: string, relative: string, startLine = 1, endLine = startLine + 99): SourceLine[] {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine > 199) {
    throw new Error("Read range must contain 1–200 positive line numbers.");
  }
  if (!files(root).includes(relative)) throw new Error("File is ignored or outside the workspace.");
  const full = safeSourceFile(root, relative);
  if (fs.statSync(full).size > 1024 * 1024) throw new Error("File is too large to read.");
  const content = fs.readFileSync(full, "utf8");
  if (content.includes("\0")) throw new Error("Binary files cannot be read as source.");
  const result: SourceLine[] = [];
  let size = 0;
  for (const [index, text] of content.split(/\r?\n/).slice(startLine - 1, endLine).entries()) {
    const clipped = text.slice(0, 1000);
    size += Buffer.byteLength(clipped);
    if (size > 32_000) break;
    result.push({ path: relative, line: startLine + index, text: clipped });
  }
  return result;
}

export function readFile(root: string, relative: string): SourceLine[] {
  return readRange(root, relative, 1, 200);
}

export function searchText(root: string, pattern: string, limit = 100): SourceLine[] {
  if (!pattern || pattern.length > 256) throw new Error("Search pattern must be 1–256 characters.");
  const result = spawnSync("rg", ["--json", "--hidden", "--no-require-git", "--max-count", "20", "--max-filesize", "1M",
    "-g", "!.git", "-g", "!node_modules", "-g", "!.env*", "-g", "!*.pem", "-g", "!*.key", "-e", pattern, "."],
  { cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(result.error.message.includes("ENOENT") ? "Ripgrep is required for regex search." : "Search failed or exceeded its limit.");
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error(`Search failed: ${(result.stderr || "invalid regex").slice(0, 200)}`);
  const visible = new Set(files(root));
  const lines: SourceLine[] = [];
  for (const raw of result.stdout.split("\n")) {
    if (!raw || lines.length >= Math.min(limit, 500)) break;
    const event = JSON.parse(raw) as { type: string; data: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    if (event.type !== "match") continue;
    const relative = event.data.path?.text?.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!relative || !visible.has(relative)) continue;
    try { safeSourceFile(root, relative); } catch { continue; }
    lines.push({ path: relative, line: event.data.line_number!, text: (event.data.lines?.text || "").trimEnd().slice(0, 300) });
  }
  return lines;
}
