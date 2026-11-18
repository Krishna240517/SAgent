import { entrypoint, task, type MemorySaver } from "@langchain/langgraph";
import type { TextPatch } from "../edit/patch.js";
import type { SandboxResult } from "../edit/sandbox.js";
import type { detectChecks } from "../edit/checks.js";

export type Proposal = { patch: TextPatch; diff: string; before: string; after: string; checks: ReturnType<typeof detectChecks> };
export type Review = { blocking: boolean; finding: string };
export type Outcome = { status: "rejected" | "failed" | "completed"; detail: string };
export type Roles = {
  plan(request: string): Promise<string>;
  propose(request: string, plan: string): Promise<Proposal>;
  approve(proposal: Proposal): Promise<boolean>;
  apply(proposal: Proposal): Promise<string>;
  test(proposal: Proposal): Promise<SandboxResult[]>;
  review(request: string, proposal: Proposal, results: SandboxResult[]): Promise<Review>;
};

export function supervisor(roles: Roles, checkpointer?: MemorySaver) {
  const planner = task("planner", roles.plan);
  const coder = task("coder", roles.propose);
  const approval = task("approval", roles.approve);
  const apply = task("apply", roles.apply);
  const tester = task("tester", roles.test);
  const reviewer = task("reviewer", roles.review);
  return entrypoint({ name: "supervisor", checkpointer }, async (request: string): Promise<Outcome> => {
    const plan = await planner(request);
    const proposal = await coder(request, plan);
    if (!await approval(proposal)) return { status: "rejected", detail: "Edit declined." };
    await apply(proposal);
    const results = await tester(proposal);
    if (!results.length || results.some(result => result.status !== "pass")) {
      return { status: "failed", detail: results.at(-1)?.output || "No passing verification." };
    }
    const review = await reviewer(request, proposal, results);
    return { status: review.blocking ? "failed" : "completed", detail: review.finding };
  });
}
