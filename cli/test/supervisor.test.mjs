import assert from "node:assert/strict";
import test from "node:test";
import { supervisor } from "../dist/context/supervisor.js";
test("supervisor runs roles in order and a blocking review prevents completion", async () => {
  const seen = [];
  const role = (name, result) => async () => { seen.push(name); return result; };
  const result = await supervisor({
    plan: role("planner", "repair"), propose: role("coder", {}), approve: role("approval", true),
    apply: role("apply", "id"), test: role("tester", [{ status: "pass" }]),
    review: role("reviewer", { blocking: true, finding: "missing edge case" })
  }).invoke("repair");
  assert.deepEqual(seen, ["planner", "coder", "approval", "apply", "tester", "reviewer"]);
  assert.equal(result.status, "failed");
});
