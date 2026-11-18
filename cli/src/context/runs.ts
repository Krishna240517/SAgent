import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { deserialize, serialize } from "node:v8";
import { MemorySaver } from "@langchain/langgraph";
import { discoverWorkspace, safeSourceFile } from "../repo/workspace.js";
import { applyPatch, recoverActions } from "../edit/patch.js";
import { atomic, queueUpsert } from "../sync/local.js";
import { supervisor, type Proposal, type Outcome } from "./supervisor.js";
import { codingRoles } from "./roles.js";

type Task = { id: string; title: string; revision: string | null; workspace_hash: string; private_required: number; summary: string | null; status: string };
type Consent = { path: string; before: string; after: string; id: string };
type State = { checkpoint: Uint8Array | null; approval: string | null; result: string | null };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function workspace(root: string, consent?: Consent) {
  const info = discoverWorkspace(root);
  const digest = createHash("sha256");
  let bytes = 0;
  if (info.files.length > 5000) throw new Error("Workspace exceeds the sandbox file limit.");
  for (const file of info.files) {
    const source = safeSourceFile(info.root, file);
    bytes += statSync(source).size;
    if (bytes > 128 * 1024 * 1024) throw new Error("Workspace exceeds the sandbox size limit.");
    let value = hash(readFileSync(source));
    if (consent?.path === file && value === consent.after) value = consent.before;
    digest.update(JSON.stringify([file, value]));
  }
  return { revision: info.revision, fingerprint: digest.digest("hex") };
}

class ProjectSaver extends MemorySaver {
  constructor(private db: DatabaseSync, private id: string, bytes: Uint8Array | null) {
    super();
    if (bytes) [this.storage, this.writes] = deserialize(bytes);
  }
  private save() {
    this.db.prepare("UPDATE run_state SET checkpoint=? WHERE id=?").run(serialize([this.storage, this.writes]), this.id);
  }
  override async put(...args: Parameters<MemorySaver["put"]>) {
    const config = await super.put(...args); this.save(); return config;
  }
  override async putWrites(...args: Parameters<MemorySaver["putWrites"]>) {
    await super.putWrites(...args); this.save();
  }
}

export function queueTask(db: DatabaseSync, id: string) {
  queueUpsert(db, "task", db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as Task);
}

export function startTask(db: DatabaseSync, root: string, title: string) {
  if (!title.trim() || title.length > 2000) throw new Error("Assignment must be 1–2000 characters.");
  const id = randomUUID(), now = new Date().toISOString();
  const { revision, fingerprint } = workspace(root);
  atomic(db, () => {
    db.prepare("INSERT INTO tasks (id,title,status,created_at,updated_at,revision,workspace_hash) VALUES (?,?,'running',?,?,?,?)")
      .run(id, title, now, now, revision, fingerprint);
    db.prepare("INSERT INTO run_state(id) VALUES (?)").run(id);
    queueTask(db, id);
  });
  return id;
}

export async function runTask(db: DatabaseSync, root: string, id: string, model: Parameters<typeof codingRoles>[2],
  approve: (diff: string) => Promise<boolean>, trace: (role: string, detail: string) => void, makeRoles = codingRoles): Promise<Outcome> {
  const file = (db.prepare("PRAGMA database_list").get() as { file: string }).file;
  const lock = new DatabaseSync(file ? file + ".run-lock" : ":memory:");
  try {
    try { lock.exec("BEGIN IMMEDIATE"); } catch { throw new Error("Another coding run is active in this project."); }
    const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as Task | undefined;
    if (!row) throw new Error("Task not found.");
    const state = db.prepare("SELECT * FROM run_state WHERE id=?").get(id) as State | undefined;
    if (state?.result) return JSON.parse(state.result);
    if (!state && (row.private_required || !row.revision || row.status !== "running")) throw new Error("Task requires its original private checkpoint.");
    let consent: Consent | undefined = state?.approval ? JSON.parse(state.approval) : undefined;
    const validate = () => {
      const current = workspace(root, consent);
      if (current.revision !== row.revision || current.fingerprint !== row.workspace_hash) throw new Error("Checkout differs from task checkpoint.");
    };
    validate();
    if (!state) db.prepare("INSERT INTO run_state(id) VALUES (?)").run(id);
    const saver = new ProjectSaver(db, id, state?.checkpoint ?? null);
    const roles = makeRoles(db, root, model, async p => {
      validate();
      if (!await approve(p.diff)) return false;
      consent = { path: p.patch.path, before: p.before, after: p.after, id: randomUUID() };
      db.prepare("UPDATE run_state SET approval=? WHERE id=?").run(JSON.stringify(consent), id);
      return true;
    }, async p => {
      validate();
      if (!consent || consent.before !== p.before || consent.after !== p.after || consent.path !== p.patch.path) throw new Error("Missing approval for this patch.");
      recoverActions(db, root);
      const previous = db.prepare("SELECT status FROM tool_actions WHERE id=?").get(consent.id);
      if (previous?.status === "completed") {
        if (hash(readFileSync(safeSourceFile(root, p.patch.path))) !== p.after) throw new Error("Applied patch changed.");
      } else {
        if (previous?.status === "failed" && hash(readFileSync(safeSourceFile(root, p.patch.path))) === p.before) {
          consent = { ...consent, id: randomUUID() };
          db.prepare("UPDATE run_state SET approval=? WHERE id=?").run(JSON.stringify(consent), id);
        } else if (previous) throw new Error("Interrupted patch conflicts with the checkout.");
        applyPatch(db, root, p.patch, p.before, consent.id);
      }
      return consent.id;
    });
    const checkApplied = (p: Proposal) => {
      validate();
      if (!consent || consent.after !== p.after || consent.path !== p.patch.path ||
        !db.prepare("SELECT 1 FROM tool_actions WHERE id=? AND status='completed'").get(consent.id) ||
        hash(readFileSync(safeSourceFile(root, p.patch.path))) !== p.after) throw new Error("Approved patch is missing or changed.");
    };
    function record(role: string, detail: string) {
      db.prepare(`INSERT INTO tool_actions (id,operation,path,before_sha,after_sha,diff,status,created_at,output)
        VALUES (?,?,?,'','','','completed',?,?)`).run(randomUUID(), role, id, new Date().toISOString(), detail.slice(0, 20000));
      trace(role, detail);
    }
    const graph = supervisor({
      ...roles,
      plan: async request => { const plan = row.summary ?? await roles.plan(request); record("Planner", plan); return plan; },
      propose: async (request, plan) => { validate(); const p = await roles.propose(request, plan); record("Coder", p.diff); return p; },
      test: async p => { checkApplied(p); const results = await roles.test(p); record("Tester", results.map(r => r.status + " " + r.output).join("\n")); return results; },
      review: async (request, p, results) => { checkApplied(p); const review = await roles.review(request, p, results); record("Reviewer", review.finding); return review; }
    }, saver);
    const config = { configurable: { thread_id: id }, durability: "sync" as const };
    const snapshot = await graph.getState(config);
    let result: Outcome;
    if (snapshot.config.configurable?.checkpoint_id && !snapshot.next.length) result = snapshot.values as Outcome;
    else {
      if (!row.private_required) atomic(db, () => {
        db.prepare("UPDATE tasks SET private_required=1 WHERE id=?").run(id); queueTask(db, id);
      });
      result = await graph.invoke(snapshot.config.configurable?.checkpoint_id ? null : row.title, config);
    }
    if (!result || !["failed", "rejected", "completed"].includes(result.status)) throw new Error("Checkpoint has no completion result.");
    validate();
    if (result.status === "completed" && (!consent || hash(readFileSync(safeSourceFile(root, consent.path))) !== consent.after)) throw new Error("Verified edit changed.");
    atomic(db, () => {
      db.prepare("UPDATE run_state SET result=? WHERE id=?").run(JSON.stringify(result), id);
      db.prepare("UPDATE tasks SET status=?, updated_at=? WHERE id=?").run(result.status === "completed" ? "completed" : "failed", new Date().toISOString(), id);
      queueTask(db, id);
    });
    return result;
  } finally { lock.close(); }
}
