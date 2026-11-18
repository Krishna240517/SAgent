import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { globFiles, readRange, searchText } from "../dist/repo/tools.js";
import { SymbolIndex } from "../dist/repo/symbols.js";

test("four-language symbol map, bounded reads, caller search, and incremental refresh", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-symbols-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q", root]);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".env\nignored.py\n");
  fs.writeFileSync(path.join(root, ".env"), "password=secret\n");
  fs.writeFileSync(path.join(root, "ignored.py"), "def stolen(): pass\n");
  fs.writeFileSync(path.join(root, "src", "main.js"), 'import { tool } from "./tool.js";\nexport function run() { return tool(); }\n');
  fs.writeFileSync(path.join(root, "src", "tool.js"), "export function tool() { return 1; }\n");
  fs.writeFileSync(path.join(root, "src", "api.ts"), 'import type { Item } from "./types";\nexport function fetchItem(id: string): string { return id; }\n');
  fs.writeFileSync(path.join(root, "src", "view.tsx"), "export const View = () => <div />;\n");
  fs.writeFileSync(path.join(root, "src", "worker.py"), "from os import path\ndef process_item():\n    return path.exists('x')\n");
  fs.writeFileSync(path.join(root, "src", "Worker.java"), "import java.util.List; class Worker { void processItem() {} }\n");
  execFileSync("git", ["-C", root, "add", ".gitignore", "src"]);
  const index = new SymbolIndex(root);
  await index.refresh();
  const entries = index.entries();
  for (const name of ["run", "tool", "fetchItem", "View", "process_item", "processItem"]) {
    assert.ok(entries.some((entry) => entry.name === name), `missing ${name}`);
  }
  assert.ok(entries.some((entry) => entry.kind === "import" && entry.path === "src/Worker.java"));
  assert.ok(globFiles(root, "**/*.ts").includes("src/api.ts"));
  assert.equal(readRange(root, "src/api.ts", 2, 2)[0].line, 2);
  assert.throws(() => readRange(root, ".env"), /ignored/);
  assert.ok(searchText(root, "tool\\(").some((entry) => entry.path === "src/main.js" && entry.line === 2));
  assert.ok(!searchText(root, "password").some((entry) => entry.path === ".env"));
  const map = index.map("fetchItem", 1200);
  assert.ok(map.includes("src/api.ts:2"));
  assert.ok(Buffer.byteLength(map) <= 1200);
  fs.writeFileSync(path.join(root, "src", "api.ts"), 'export function fetchItemNew(id: string): string { return id; }\n');
  await index.refresh();
  assert.ok(index.entries().some((entry) => entry.name === "fetchItemNew"));
  assert.ok(!index.entries().some((entry) => entry.name === "fetchItem"));
});
