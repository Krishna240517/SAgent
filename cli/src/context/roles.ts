import type { DatabaseSync } from "node:sqlite";
import { activeDecisions } from "../chat/store.js";
import { SymbolIndex } from "../repo/symbols.js";
import { buildContext, collectEvidence, type ContextSource, type Role } from "./engine.js";
import { previewPatch } from "../edit/patch.js";
import { detectChecks } from "../edit/checks.js";
import { runSandbox, sandboxAvailability } from "../edit/sandbox.js";
import type { Roles } from "./supervisor.js";

export function codingRoles(db: DatabaseSync, root: string, model: (prompt: string, context: string) => Promise<string>,
  approval: Roles["approve"], apply: Roles["apply"]): Roles {
  async function context(role: Role, request: string, artifacts: ContextSource[] = []) {
    const index = new SymbolIndex(root);
    await index.refresh();
    return buildContext(request, [...artifacts, ...activeDecisions(db).map(d => ({
      id: "decision:" + d.id, kind: "decision" as const, content: d.content
    })), ...collectEvidence(root, request, index)], role).context;
  }
  return {
    plan: async request => {
      const plan = (await model("Plan one small edit for this assignment: " + request, await context("planner", request))).trim();
      if (!plan || plan.length > 4000) throw new Error("Planner returned an empty or oversized plan.");
      return plan;
    },
    propose: async (request, plan) => {
      const raw = await model("Return one exact replacement as JSON with string fields path, oldText, newText. Task: " + request,
        await context("coder", request, [{ kind: "summary", id: "planner:plan", content: plan }]));
      const {path, oldText, newText} = JSON.parse(raw);
      const patch = {path, oldText, newText};
      const preview = previewPatch(root, patch);
      const checks = detectChecks(root, preview.relative);
      if (!checks.checks.length) throw new Error("No supported check for this edit.");
      for (const kind of checks.checks) {
        const reason = sandboxAvailability(kind);
        if (reason) throw new Error(reason);
      }
      return { patch: {...patch,path:preview.relative}, diff: preview.diff, before: preview.beforeSha, after: preview.afterSha, checks };
    },
    approve: approval, apply,
    test: async proposal => {
      const results = [];
      for (const kind of proposal.checks.checks) {
        const result = runSandbox(root, kind, undefined, proposal.checks.directory, kind.endsWith(":focused") ? proposal.checks.focus : "");
        results.push(result);
        if (result.status !== "pass") break;
      }
      return results;
    },
    review: async (request, proposal, results) => {
      const artifacts: ContextSource[] = [{ id: "coder:diff", kind: "tool", content: proposal.diff },
      ...results.map((r, i) => ({ id: "tester:" + i, kind: "tool" as const, content: r.status + " " + r.output.slice(-2000) }))];
      const review = JSON.parse(await model("Review the change against the assignment. Return JSON with boolean blocking and string finding. Assignment: " + request,
        await context("reviewer", request, artifacts)));
      if (typeof review?.blocking !== "boolean" || typeof review.finding !== "string" || !review.finding.trim()) throw new Error("Invalid review.");
      return { blocking: review.blocking, finding: review.finding };
    }
  };
}
