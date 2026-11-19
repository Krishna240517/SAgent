import { activeDecisions } from "../chat/store.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { buildContext, collectEvidence, type ContextSource } from "../context/engine.js";
import { SymbolIndex } from "../repo/symbols.js";
import { applyPatch, previewPatch, type TextPatch } from "./patch.js";
import { detectChecks } from "./checks.js";
import { requireToolPermission } from "./policy.js";
import { runSandbox, sandboxAvailability, type CheckKind, type SandboxResult } from "./sandbox.js";

type Propose = (prompt: string, context: string) => Promise<string>;
type Approve = (diff: string) => Promise<boolean>;
type Verify = typeof runSandbox;
type Availability = (kind: CheckKind) => string | null;

function logAction(db: DatabaseSync, operation: string, path: string, status: string, output: string, diff = "") {
  const id = randomUUID();
  db.prepare("INSERT INTO tool_actions (id, operation, path, before_sha, after_sha, diff, status, created_at, output) VALUES (?, ?, ?, '', '', ?, ?, ?, ?)")
    .run(id, operation, path, diff, status, new Date().toISOString(), output.slice(0, 20_000));
  return id;
}

export async function executeFix(db: DatabaseSync, root: string, task: string, propose: Propose, approve: Approve,
  verify: Verify = runSandbox, availability: Availability = sandboxAvailability) {
  if (!task.trim() || task.length > 2_000) throw new Error("Coding task must be 1–2,000 characters.");
  const index = new SymbolIndex(root);
  await index.refresh();
  const decisions = activeDecisions(db);
  const sources: ContextSource[] = [
    ...decisions.map((item) => ({ id: `decision:${item.id}`, kind: "decision" as const, content: item.content })),
    ...collectEvidence(root, task, index),
  ];
  const context = buildContext(task, sources, "coder");
  logAction(db, "read", "", "completed", JSON.stringify(context.sourceIds));
  // shortcut: one approved patch per invocation; add bounded repair attempts after live task results justify them.
  const prompt = `Task: ${task}\nPropose exactly one small edit to an existing source file. Return only JSON with string fields path, oldText, newText. oldText must be an exact, unique span from the file. Do not request shell commands, deletions, network, credentials, publishing, or remote writes.`;
  const raw = await propose(prompt, context.context);
  let patch: TextPatch;
  try { patch = JSON.parse(raw.trim()) as TextPatch; }
  catch { logAction(db, "proposal", "", "failed", raw); throw new Error("Model did not return a valid JSON patch."); }
  let preview: ReturnType<typeof previewPatch>;
  try { preview = previewPatch(root, patch); }
  catch (error) { logAction(db, "proposal", "", "failed", String(error)); throw error; }
  logAction(db, "proposal", preview.relative, "completed", raw, preview.diff);
  const plan = detectChecks(root, preview.relative);
  if (!plan.checks.length) throw new Error("No supported verification check was found; edit was not applied.");
  for (const kind of plan.checks) {
    const unavailable = availability(kind);
    if (unavailable) throw new Error(unavailable);
  }
  const approved = await approve(preview.diff);
  if (!approved) {
    logAction(db, "approval", preview.relative, "rejected", "User declined the patch.", preview.diff);
    return { status: "rejected" as const, diff: preview.diff, actionId: null, checks: [] };
  }
  requireToolPermission("patch", approved);
  const action = applyPatch(db, root, patch, preview.beforeSha);
  await index.refresh();
  const results: { kind: CheckKind; result: SandboxResult }[] = [];
  for (const kind of plan.checks) {
    let result: SandboxResult;
    try { result = verify(root, kind, undefined, plan.directory, kind.endsWith(":focused") ? plan.focus : ""); }
    catch (error) { result = { status: "fail", exitCode: null, output: String(error) }; }
    results.push({ kind, result });
    logAction(db, `sandbox:${kind}`, action.path, result.status === "pass" ? "completed" : "failed", result.output);
    if (result.status !== "pass") return { status: result.status === "unavailable" ? "unverified" as const : "failed" as const,
      diff: preview.diff, actionId: action.id, checks: results };
  }
  return { status: "verified" as const, diff: preview.diff, actionId: action.id, checks: results };
}
