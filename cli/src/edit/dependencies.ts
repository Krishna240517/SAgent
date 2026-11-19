import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverWorkspace, safeSourceFile } from "../repo/workspace.js";

export const dependencyPlans = {
  npm: { image: "node:22-alpine", install: "npm ci", save: "cp -R node_modules /deps/node_modules" },
  python: { image: "python:3.13-alpine", install: "python -m venv /deps/venv && /deps/venv/bin/pip install -r requirements.txt", save: "true" },
  maven: { image: "maven:3.9-eclipse-temurin-21", install: "mvn -B -Dmaven.repo.local=/deps/m2 test", save: "true" },
  gradle: { image: "gradle:8-jdk21-alpine", install: "gradle --gradle-user-home /deps/gradle test --no-daemon", save: "true" },
};
export type DependencyKind = keyof typeof dependencyPlans;

export function dependencyImage(root: string, directory: string, kind: DependencyKind) {
  const workspace = discoverWorkspace(root);
  if (directory && (path.isAbsolute(directory) || directory.split(/[\\/]/).some(p => !p || p === ".."))) throw new Error("Invalid dependency directory.");
  const full = fs.realpathSync(path.join(workspace.root, directory));
  const relative = path.relative(workspace.root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Dependency directory escapes workspace.");
  const hash = createHash("sha256").update(workspace.root).update(directory).update(kind).update("v1");
  for (const file of workspace.files.filter(file => /(^|\/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.(py|cfg)|pom\.xml|[^/]*\.gradle(\.kts)?|gradle\.properties|[^/]*\.lock(file)?)$/.test(file))) {
    hash.update(file).update(fs.readFileSync(safeSourceFile(workspace.root, file)));
  }
  return "sagent-deps:" + hash.digest("hex");
}

export function prepareDependencies(root: string, directory: string, kind: DependencyKind, approved: boolean) {
  if (!approved) throw new Error("Dependency preparation requires approval for network access and package scripts.");
  const plan = dependencyPlans[kind];
  if (!Object.hasOwn(dependencyPlans, kind)) throw new Error("Unsupported dependency manager.");
  const endpoint = spawnSync("docker", ["--context", "default", "context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8", timeout: 10000 });
  if (endpoint.status !== 0 || !/^(unix:\/\/|npipe:\/\/)/.test(endpoint.stdout.trim())) throw new Error("Dependency preparation requires local Docker.");
  const pulled = spawnSync("docker", ["--context", "default", "pull", plan.image], { encoding: "utf8", timeout: 300000, maxBuffer: 1024 * 1024 });
  if (pulled.status !== 0) throw new Error("Could not install the sandbox base image.");
  const tag = dependencyImage(root, directory, kind);
  const workspace = discoverWorkspace(root);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-deps-"));
  try {
    let size = 0;
    if (workspace.files.length > 5000) throw new Error("Dependency build exceeds file limit.");
    for (const file of workspace.files) {
      const source = safeSourceFile(workspace.root, file);
      size += fs.statSync(source).size;
      if (size > 128 * 1024 * 1024) throw new Error("Dependency build exceeds 128 MiB.");
      const target = path.join(temporary, "source", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    const workdir = "/source/" + directory.replaceAll("\\", "/");
    const dockerfile = [
      "FROM " + plan.image,
      "USER root",
      "RUN mkdir -p /deps /source /prepare-home && chown -R 65532:65532 /deps /source /prepare-home",
      "COPY --chown=65532:65532 source/ /source/",
      "USER 65532:65532",
      "ENV HOME=/prepare-home",
      "WORKDIR /source",
      "RUN " + JSON.stringify(["sh", "-c", 'cd "$1" && ' + plan.install + " && " + plan.save, "prepare", workdir]),
      "WORKDIR /",
    ].join("\n");
    fs.writeFileSync(path.join(temporary, "Dockerfile"), dockerfile);
    const result = spawnSync("docker", ["--context", "default", "build", "--tag", tag, temporary], {
      encoding: "utf8", timeout: 900000, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error("Dependency image build failed. " + (result.stderr || result.error?.message || "").slice(-6000));
    return tag;
  } finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) throw new Error("Unexpected cleanup path.");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
