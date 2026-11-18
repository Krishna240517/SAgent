import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverWorkspace, safeSourceFile } from "../repo/workspace.js";
import { requireToolPermission } from "./policy.js";

export type CheckKind = "node:focused" | "node:test" | "typescript:focused" | "typescript:test" | "npm:test" | "npm:typecheck" | "python:focused" | "python:unittest" | "java:compile" | "maven:test" | "gradle:test";
export type SandboxResult = { status: "pass" | "fail" | "timeout" | "unavailable"; exitCode: number | null; output: string };

const checks: Record<CheckKind, { image: string; argv: string[] }> = {
  "node:focused": { image: "node:22-alpine", argv: ["node", "--test"] },
  "node:test": { image: "node:22-alpine", argv: ["node", "--test"] },
  "typescript:focused": { image: "node:22-alpine", argv: ["node", "--experimental-strip-types", "--test"] },
  "typescript:test": { image: "node:22-alpine", argv: ["node", "--experimental-strip-types", "--test"] },
  "npm:test": { image: "node:22-alpine", argv: ["npm", "test"] },
  "npm:typecheck": { image: "node:22-alpine", argv: ["npm", "run", "typecheck"] },
  "python:focused": { image: "python:3.13-alpine", argv: ["python", "-m", "unittest"] },
  "python:unittest": { image: "python:3.13-alpine", argv: ["python", "-m", "unittest", "discover"] },
  "java:compile": { image: "eclipse-temurin:21-jdk-alpine", argv: ["javac"] },
  "maven:test": { image: "maven:3.9-eclipse-temurin-21", argv: ["mvn", "test", "-o"] },
  "gradle:test": { image: "gradle:8-jdk21-alpine", argv: ["gradle", "test", "--offline", "--no-daemon"] },
};

function docker(args: string[], timeout = 10_000) {
  return spawnSync("docker", ["--context", "default", ...args], { encoding: "utf8", timeout, maxBuffer: 64 * 1024 });
}

function localDocker(): boolean {
  const context = docker(["context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"]);
  if (context.status !== 0 || !/^(unix:\/\/|npipe:\/\/)/.test(context.stdout.trim())) return false;
  const info = docker(["info", "--format", "{{.OSType}}"]);
  return info.status === 0 && info.stdout.trim() === "linux";
}

export function sandboxAvailability(kind: CheckKind): string | null {
  const check = checks[kind];
  if (!check) throw new Error("Unsupported sandbox check.");
  if (!localDocker()) return "Local Linux Docker is unavailable; verified execution was not performed.";
  if (docker(["image", "inspect", check.image]).status !== 0) return `Docker image ${check.image} is not installed; verified execution was not performed.`;
  return null;
}

export function runSandbox(root: string, kind: CheckKind, timeoutMs = 90_000, subdir = "", focus = ""): SandboxResult {
  requireToolPermission("sandbox_test");
  const check = checks[kind];
  if (!check || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) throw new Error("Unsupported sandbox check or timeout.");
  const directory = subdir.replaceAll("\\", "/");
  const focused = kind.endsWith(":focused");
  if (focused !== Boolean(focus) || (focus && (path.isAbsolute(focus) || focus.split("/").some((part) => !part || part === "..")))) {
    throw new Error("Invalid focused test path.");
  }
  if (directory) {
    if (path.isAbsolute(directory) || directory.split("/").some((part) => !part || part === "..")) throw new Error("Sandbox directory is outside the workspace.");
    const resolved = fs.realpathSync(path.join(root, directory));
    const within = path.relative(fs.realpathSync(root), resolved);
    if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within) || !fs.statSync(resolved).isDirectory()) {
      throw new Error("Sandbox directory is outside the workspace.");
    }
  }
  const unavailable = sandboxAvailability(kind);
  if (unavailable) return { status: "unavailable", exitCode: null, output: unavailable };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-sandbox-"));
  // Keep the host directory private. Only its child is mounted for the container UID.
  const snapshot = path.join(temporary, "input");
  function makeInputDirectory(directory: string) {
    if (fs.existsSync(directory)) return;
    makeInputDirectory(path.dirname(directory));
    fs.mkdirSync(directory);
    fs.chmodSync(directory, 0o755);
  }
  const name = `sagent-${randomUUID()}`;
  try {
    makeInputDirectory(snapshot);
    const workspace = discoverWorkspace(root);
    if (focus && (!workspace.files.includes(directory ? `${directory}/${focus}` : focus) ||
        !safeSourceFile(workspace.root, directory ? `${directory}/${focus}` : focus))) throw new Error("Focused test is outside the workspace.");
    let bytes = 0;
    if (workspace.files.length > 5_000) throw new Error("Workspace exceeds the 5,000-file sandbox snapshot limit.");
    for (const file of workspace.files) {
      const source = safeSourceFile(workspace.root, file);
      bytes += fs.statSync(source).size;
      if (bytes > 128 * 1024 * 1024) throw new Error("Workspace exceeds the 128 MiB sandbox snapshot limit.");
      const destination = path.join(snapshot, file);
      makeInputDirectory(path.dirname(destination));
      fs.copyFileSync(source, destination);
      if (process.platform !== "win32") fs.chmodSync(destination, fs.statSync(source).mode & 0o111 ? 0o755 : 0o644);
    }
    const argv = kind === "java:compile" ? [...check.argv, ...workspace.files.filter((file) => file.endsWith(".java") && (!directory || file.startsWith(`${directory}/`)))
      .map((file) => directory ? file.slice(directory.length + 1) : file)] : focus ? [...check.argv, focus] : check.argv;
    if (kind === "java:compile" && argv.length === 1) throw new Error("No Java files are available to compile.");
    const result = docker(["run", "--rm", "--name", name, "--pull=never", "--network=none", "--read-only",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65532:65532",
      "--cpus=1", "--memory=512m", "--memory-swap=512m", "--pids-limit=64",
      "--tmpfs=/tmp:rw,nosuid,noexec,size=64m,uid=65532,gid=65532",
      "--tmpfs=/work:rw,nosuid,size=256m,uid=65532,gid=65532",
      `--mount=type=bind,source=${snapshot},target=/input,readonly`, `--workdir=/work${directory ? `/${directory}` : ""}`,
      "--env=HOME=/tmp", "--env=TMPDIR=/tmp", check.image,
      "sh", "-c", "cp -R /input/. /work/ && exec \"$@\"", "sagent", ...argv], timeoutMs);
    const output = `${result.stdout || ""}${result.stderr || ""}`.slice(0, 64_000);
    if (result.error) return { status: result.error.message.includes("ETIMEDOUT") ? "timeout" : "fail", exitCode: null, output: output || result.error.message };
    return { status: result.status === 0 ? "pass" : "fail", exitCode: result.status, output };
  } finally {
    docker(["rm", "-f", name]);
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) throw new Error("Unexpected sandbox cleanup path.");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
