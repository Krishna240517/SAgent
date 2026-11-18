import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const hidden = new Set([".git", ".sagent", ".ssh", ".aws", ".azure", ".kube", ".terraform", "node_modules", "dist", "build", "target", ".next", ".venv", "__pycache__"]);
const buildNames = new Set(["package.json", "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "gradlew", "Makefile", "tsconfig.json"]);
const languages: Record<string, string> = { ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".java": "Java" };

function git(root: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
}

export function workspaceRoot(start = process.cwd()): string {
  const directory = fs.realpathSync(start);
  if (!fs.statSync(directory).isDirectory()) throw new Error("Workspace path is not a directory.");
  return fs.realpathSync(git(directory, "rev-parse", "--show-toplevel")?.trim() || directory);
}

export function safeSourceFile(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === "..")) {
    throw new Error("Path is outside the readable workspace.");
  }
  function guard(name: string) {
    if (name.split(/[\\/]/).some((part) => hidden.has(part.toLowerCase()))) throw new Error("Path is outside the readable workspace.");
    const base = path.basename(name).toLowerCase();
    if ((base.startsWith(".env") && base !== ".env.example") ||
        /(^|[._-])(secret|credential|token|password|private)([._-]|$)/i.test(base) ||
        [".npmrc", ".pypirc", "id_rsa", "id_ed25519"].includes(base) ||
        /\.(pem|key|p12|pfx|jks|keystore|sqlite|db)$/i.test(base)) throw new Error("Credential or local database files are excluded.");
  }
  guard(relative);
  const full = fs.realpathSync(path.resolve(root, relative));
  const within = path.relative(fs.realpathSync(root), full);
  if (!within || within.startsWith(".." + path.sep) || within === ".." || path.isAbsolute(within) || !fs.statSync(full).isFile()) {
    throw new Error("Path is outside the readable workspace.");
  }
  guard(within);
  return full;
}

function fallbackFiles(root: string): string[] {
  try {
    return execFileSync("rg", ["--files", "--hidden", "--no-require-git", "-0", "-g", "!.git"], {
      cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/").replace(/^\.\//, ""));
  } catch {
    // shortcut: a non-Git workspace needs ripgrep to honor ignore rules; package a binary if this blocks installs.
    throw new Error("Ripgrep is required to inspect a directory without Git.");
  }
}

export function discoverWorkspace(start = process.cwd()) {
  const root = workspaceRoot(start);
  const isGit = git(root, "rev-parse", "--is-inside-work-tree")?.trim() === "true";
  const tracked = isGit ? (git(root, "ls-files", "-z", "--cached") || "").split("\0").filter(Boolean) : [];
  const untracked = isGit ? (git(root, "ls-files", "-z", "--others", "--exclude-standard") || "").split("\0").filter(Boolean) : fallbackFiles(root);
  const readable = (files: string[]) => files.filter((file) => { try { safeSourceFile(root, file); return true; } catch { return false; } });
  const trackedFiles = readable(tracked);
  const untrackedFiles = readable(untracked);
  const files = [...new Set([...trackedFiles, ...untrackedFiles])].sort();
  const languageMix: Record<string, number> = {};
  for (const file of files) {
    const language = languages[path.extname(file).toLowerCase()];
    if (language) languageMix[language] = (languageMix[language] || 0) + 1;
  }
  return {
    root, isGit,
    branch: isGit ? git(root, "symbolic-ref", "--quiet", "--short", "HEAD")?.trim() || "(detached)" : null,
    revision: isGit ? git(root, "rev-parse", "HEAD")?.trim() || null : null,
    status: isGit ? (git(root, "status", "--short", "--untracked-files=normal") || "").trim().split("\n").filter(Boolean).slice(0, 200) : [],
    trackedFiles, untrackedFiles, files, languageMix,
    buildFiles: files.filter((file) => buildNames.has(path.basename(file))),
    ignoreFiles: files.filter((file) => [".gitignore", ".ignore"].includes(path.basename(file))),
  };
}

export function requireRevision(root: string, expected: string): void {
  const current = git(root, "rev-parse", "HEAD")?.trim();
  if (!current || current !== expected) throw new Error(`Git revision mismatch: expected ${expected}, found ${current || "none"}.`);
}
