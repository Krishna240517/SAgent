import fs from "node:fs";
import path from "node:path";
import { discoverWorkspace } from "../repo/workspace.js";
import type { CheckKind } from "./sandbox.js";

export function detectChecks(root: string, changedPath: string): { directory: string; focus: string; checks: CheckKind[] } {
  const files = discoverWorkspace(root).files;
  if (!files.includes(changedPath)) throw new Error("Changed file is outside the readable workspace.");
  const extension = path.extname(changedPath).toLowerCase();
  let directory = path.posix.dirname(changedPath);
  if (directory === ".") directory = "";
  const findBuild = (names: string[]) => {
    let current = directory;
    while (true) {
      for (const name of names) if (files.includes(current ? `${current}/${name}` : name)) return { directory: current, name };
      if (!current) return undefined;
      const parent = path.posix.dirname(current);
      current = parent === "." ? "" : parent;
    }
  };
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension)) {
    const packageFile = findBuild(["package.json"]);
    const checks: CheckKind[] = [];
    if (packageFile) {
      const packageJson = JSON.parse(fs.readFileSync(path.join(root, packageFile.directory, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      if (packageJson.scripts?.test) checks.push("npm:test");
      if (packageJson.scripts?.typecheck) checks.push("npm:typecheck");
      directory = packageFile.directory;
    }
    const base = path.posix.basename(changedPath).replace(/\.[^.]+$/, "");
    const prefix = directory ? `${directory}/` : "";
    const match = files.find((file) => file.startsWith(prefix) && file.slice(prefix.length).match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.test\\.(?:[cm]?js|tsx?)$`)));
    const focus = match ? match.slice(prefix.length) : "";
    if (focus) checks.unshift([".ts", ".tsx"].includes(extension) ? "typescript:focused" : "node:focused");
    if (!packageFile && files.some((file) => file.startsWith(prefix) && /(?:^|\/)\S+\.test\.(?:[cm]?js|tsx?)$/.test(file))) {
      checks.push([".ts", ".tsx"].includes(extension) ? "typescript:test" : "node:test");
    }
    return { directory, focus, checks };
  }
  if (extension === ".py") {
    const project = findBuild(["pyproject.toml", "requirements.txt"]);
    if (project) directory = project.directory;
    const prefix = directory ? `${directory}/` : "";
    const focus = `test_${path.posix.basename(changedPath)}`;
    const checks: CheckKind[] = [];
    if (files.includes(`${prefix}${focus}`)) checks.push("python:focused");
    if (files.some((file) => file.startsWith(prefix) && /(?:^|\/)test_?[^/]*\.py$/.test(file))) checks.push("python:unittest");
    return { directory, focus: checks[0] === "python:focused" ? focus : "", checks };
  }
  if (extension === ".java") {
    const project = findBuild(["pom.xml", "build.gradle", "build.gradle.kts"]);
    if (project) directory = project.directory;
    return { directory, focus: "", checks: [project?.name === "pom.xml" ? "maven:test" : project ? "gradle:test" : "java:compile"] };
  }
  return { directory, focus: "", checks: [] };
}
