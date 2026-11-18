import { Command } from "commander";
import { API_URL } from "../config.js";
import { getStoredToken } from "../commands/auth/token.js";
import { linkProject, openProjectStore } from "../storage/index.js";
import { discoverWorkspace, requireRevision } from "./workspace.js";
import { globFiles, readRange, searchText } from "./tools.js";
import { SymbolIndex } from "./symbols.js";
import { listConflicts, localRecord, resolveConflict, syncNow } from "../sync/client.js";

async function projects(token: string): Promise<{ id: string; remoteUrl: string | null }[]> {
  const response = await fetch(`${API_URL}/api/sync/projects`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Project list failed (${response.status}).`);
  return ((await response.json()) as { projects: { id: string; remoteUrl: string | null }[] }).projects;
}

export const project = new Command("project").description("Inspect and link the current workspace");
project.command("inspect").description("Show repository state without reading file contents").action(() => {
  const workspace = discoverWorkspace();
  const opened = openProjectStore(workspace.root);
  opened.db.close();
  console.log(JSON.stringify({ projectId: opened.link.project_id, root: workspace.root, branch: workspace.branch,
    revision: workspace.revision, status: workspace.status, tracked: workspace.trackedFiles.length,
    untracked: workspace.untrackedFiles.length, languages: workspace.languageMix,
    buildFiles: workspace.buildFiles, ignoreFiles: workspace.ignoreFiles }, null, 2));
});
project.command("check-revision <sha>").description("Require the expected Git commit before resuming work").action((sha: string) => {
  requireRevision(discoverWorkspace().root, sha);
  console.log("Git revision matches.");
});
project.command("register").description("Register this project's ID with your account").action(async () => {
  const token = await getStoredToken();
  if (!token) throw new Error("Run sagent login first.");
  const opened = openProjectStore();
  opened.db.close();
  const response = await fetch(`${API_URL}/api/sync/projects`, {
    method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ id: opened.link.project_id, remoteUrl: opened.link.remote_url }),
  });
  if (!response.ok) throw new Error(`Project registration failed (${response.status}).`);
  console.log(`Registered project ${opened.link.project_id}`);
});
project.command("list").description("List your registered project IDs").action(async () => {
  const token = await getStoredToken();
  if (!token) throw new Error("Run sagent login first.");
  for (const item of await projects(token.access_token)) console.log(`${item.id}  ${item.remoteUrl || "(no Git remote)"}`);
});
project.command("link <id>").description("Link this checkout to a registered project ID").action(async (id: string) => {
  const token = await getStoredToken();
  if (!token) throw new Error("Run sagent login first.");
  const target = (await projects(token.access_token)).find((item) => item.id === id);
  if (!target) throw new Error("Project ID is not registered to your account.");
  const current = openProjectStore();
  current.db.close();
  if (target.remoteUrl && current.link.remote_url && target.remoteUrl !== current.link.remote_url) {
    throw new Error("Git remote differs from the registered project.");
  }
  console.log(`Linked ${linkProject(process.cwd(), id).local_path} to ${id}`);
});
project.command("sync").description("Sync this registered project's chats and decisions").action(async () => {
  const token = await getStoredToken();
  if (!token) throw new Error("Run sagent login first.");
  const opened = openProjectStore();
  try {
    const result = await syncNow(opened.db, token.access_token, opened.link.project_id);
    console.log(`Project sync: pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}.`);
    if (result.conflicts) console.log("Run sagent project conflicts to review them.");
  } finally { opened.db.close(); }
});
project.command("conflicts").description("Review project sync conflicts").action(() => {
  const opened = openProjectStore();
  try {
    for (const item of listConflicts(opened.db)) {
      console.log(`${item.entity_type} ${item.entity_id}`);
      console.log(`  local: ${JSON.stringify(localRecord(opened.db, item.entity_type, item.entity_id))}`);
      console.log(`  remote: ${item.remote_payload_json}`);
    }
  } finally { opened.db.close(); }
});
project.command("resolve <kind> <id> <choice>").description("Choose local or remote project record").action((kind: string, id: string, choice: string) => {
  if (!["conversation", "message", "decision"].includes(kind) || !["local", "remote"].includes(choice)) throw new Error("Choose conversation/message/decision and local/remote.");
  const opened = openProjectStore();
  try { resolveConflict(opened.db, kind as "conversation" | "message" | "decision", id, choice as "local" | "remote"); }
  finally { opened.db.close(); }
});

export const repo = new Command("repo").description("Read-only repository search and symbols");
repo.command("glob <pattern>").description("List matching readable paths").action((pattern: string) => {
  for (const file of globFiles(discoverWorkspace().root, pattern)) console.log(file);
});
repo.command("search <regex>").description("Search source with bundled Ripgrep").action((pattern: string) => {
  const root = discoverWorkspace().root;
  for (const item of searchText(root, pattern)) console.log(`${item.path}:${item.line}: ${item.text}`);
});
repo.command("read <path>").description("Read up to 200 source lines").option("--start <line>", "First line", "1").option("--end <line>", "Last line", "200")
  .action((file: string, options: { start: string; end: string }) => {
    const root = discoverWorkspace().root;
    for (const item of readRange(root, file, Number(options.start), Number(options.end))) console.log(`${item.path}:${item.line}: ${item.text}`);
  });
repo.command("git").description("Show branch, revision, and working tree changes").action(() => {
  const info = discoverWorkspace();
  console.log(JSON.stringify({ root: info.root, branch: info.branch, revision: info.revision, status: info.status }, null, 2));
});
repo.command("map [query]").description("Show a bounded syntax map").option("--budget <tokens>", "Maximum map token budget", "4000")
  .action(async (query: string | undefined, options: { budget: string }) => {
    const index = new SymbolIndex(discoverWorkspace().root);
    await index.refresh();
    process.stdout.write(index.map(query || "", Number(options.budget)));
  });
