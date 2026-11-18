import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("read-only code questions cite implementations and callers in four languages", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-code-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.mkdirSync(path.join(home, ".sagent"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  fs.writeFileSync(path.join(repo, ".gitignore"), ".env\n");
  fs.writeFileSync(path.join(repo, ".env"), "PRIVATE_SECRET=do-not-send\n");
  fs.writeFileSync(path.join(repo, "src", "api.ts"), "export function fetchItem(id: string) { return id; }\n");
  fs.writeFileSync(path.join(repo, "src", "use.ts"), "import { fetchItem } from './api';\nexport const result = fetchItem('x');\n");
  fs.writeFileSync(path.join(repo, "src", "tool.js"), "export function tool() { return 1; }\n");
  fs.writeFileSync(path.join(repo, "src", "main.js"), "import { tool } from './tool.js';\nexport const result = tool();\n");
  fs.writeFileSync(path.join(repo, "src", "worker.py"), "def process_item():\n    return 1\n");
  fs.writeFileSync(path.join(repo, "src", "use_worker.py"), "from worker import process_item\nresult = process_item()\n");
  fs.writeFileSync(path.join(repo, "src", "Worker.java"), "class Worker { void processItem() {} }\n");
  fs.writeFileSync(path.join(repo, "src", "UseWorker.java"), "class UseWorker { void run() { new Worker().processItem(); } }\n");
  execFileSync("git", ["-C", repo, "add", ".gitignore", "src"]);
  fs.writeFileSync(path.join(home, ".sagent", "token.json"), JSON.stringify({ access_token: "test-token", expires_at: null }));
  const cases = [
    { symbol: "fetchItem", definition: "src/api.ts", caller: "src/use.ts" },
    { symbol: "tool", definition: "src/tool.js", caller: "src/main.js" },
    { symbol: "process_item", definition: "src/worker.py", caller: "src/use_worker.py" },
    { symbol: "processItem", definition: "src/Worker.java", caller: "src/UseWorker.java" },
  ];
  const script = `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    const cases = JSON.parse(process.env.SAGENT_CASES);
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const example = cases.find((item) => body.messages[0].content.includes(item.symbol));
      assert.ok(example);
      const sources = JSON.parse(body.context).sources;
      assert.ok(sources.some((item) => item.kind === 'file' && item.id.startsWith('file:' + example.definition + ':')));
      assert.ok(sources.some((item) => item.kind === 'file' && item.id.startsWith('file:' + example.caller + ':')));
      assert.ok(!body.context.includes('do-not-send'));
      const answer = example.symbol + ' is defined in ' + example.definition + ':1 and called in ' + example.caller + ':2.';
      const events = 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: answer }) + '\\n\\ndata: {"type":"response.completed"}\\n\\n';
      return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const { code } = await import(pathToFileURL(process.env.SAGENT_CODE_ENTRY).href);
    for (const example of cases) await code.parseAsync(['ask', 'Where is ' + example.symbol + ' called?', '--new'], { from: 'user' });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home,
      SAGENT_CODE_ENTRY: path.resolve(import.meta.dirname, "../dist/context/commands.js"), SAGENT_CASES: JSON.stringify(cases) },
    encoding: "utf8", timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  for (const item of cases) assert.ok(result.stdout.includes(`${item.definition}:1`));
  assert.ok(result.stdout.includes("Sources:"));
  assert.ok(!result.stdout.includes("do-not-send"));
});
