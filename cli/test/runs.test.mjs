import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openProjectStore } from "../dist/storage/index.js";
import { previewPatch } from "../dist/edit/patch.js";
import { startTask, runTask } from "../dist/context/runs.js";
import { activeDecisions, addDecision } from "../dist/chat/store.js";

test("SQLite checkpoint resumes testing without replaying approved edits", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-run-"));
  const root = path.join(temp, "repo"); fs.mkdirSync(root);
  const file = path.join(root, "app.js"); fs.writeFileSync(file, "const a=1;\n");
  let { db } = openProjectStore(root, temp);
  t.after(() => { db.close(); assert.equal(path.dirname(temp), os.tmpdir()); fs.rmSync(temp, { recursive: true, force: true }); });
  const old = addDecision(db, "old"); addDecision(db, "new", old.id);
  assert.deepEqual(activeDecisions(db).map(d => d.content), ["new"]);
  const id = startTask(db, root, "repair");
  const seen = []; let stop = "plan";
  const factory = (_db, _root, _model, approve, apply) => ({
    plan: async () => { if (stop === "plan") throw new Error("planner stopped"); seen.push("plan"); return "change one"; },
    propose: async () => {
      seen.push("propose"); const patch = { path: "app.js", oldText: "a=1", newText: "a=2" };
      const p = previewPatch(root, patch); return { patch, before: p.beforeSha, after: p.afterSha, diff: p.diff, checks: { checks: [] } };
    },
    approve, apply: async p => { const id = await apply(p); if (stop === "edit") throw new Error("edit stopped"); return id; },
    test: async () => { if (stop === "test") throw new Error("simulated stop"); return [{ status: "pass", output: "ok", exitCode: 0 }]; },
    review: async () => ({ blocking: false, finding: "accepted" })
  });
  const run = () => runTask(db, root, id, async () => "", async () => { seen.push("approve"); return true; }, () => { }, factory);
  await assert.rejects(run(), /planner stopped/);
  db.close(); ({ db } = openProjectStore(root, temp)); stop = "edit";
  await assert.rejects(run(), /edit stopped/);
  db.close(); ({ db } = openProjectStore(root, temp)); stop = "test";
  await assert.rejects(run(), /simulated stop/);
  assert.equal(fs.readFileSync(file, "utf8"), "const a=2;\n");
  db.close(); ({ db } = openProjectStore(root, temp));
  fs.writeFileSync(path.join(root, "extra.js"), "different");
  await assert.rejects(run(), /Checkout differs/);
  fs.unlinkSync(path.join(root, "extra.js")); stop = "";
  const approval = db.prepare("SELECT approval FROM run_state WHERE id=?").get(id).approval;
  db.prepare("UPDATE run_state SET approval=NULL WHERE id=?").run(id);
  await assert.rejects(run(), /Checkout differs|approval|patch is missing/i);
  db.prepare("UPDATE run_state SET approval=? WHERE id=?").run(approval,id);
  assert.equal((await run()).status, "completed");
  assert.deepEqual(seen, ["plan", "propose", "approve"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tool_actions WHERE operation='patch'").get().n, 1);
});

test("model fixtures drive the real roles, approval and Docker verification", async t => {
  const {sandboxAvailability}=await import("../dist/edit/sandbox.js");
  const unavailable=sandboxAvailability("node:test");
  if(unavailable) return t.skip(unavailable);
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"sagent-roles-"));
  const root=path.join(home,"repo");fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,"value.js"),"exports.value = 1;\n");
  fs.writeFileSync(path.join(root,"value.test.js"),"require('node:assert/strict').equal(require('./value').value,2);\n");
  const {db}=openProjectStore(root,home);
  t.after(()=>{db.close();assert.equal(path.dirname(home),os.tmpdir());fs.rmSync(home,{recursive:true,force:true});});
  const id=startTask(db,root,"fix value");
  const calls=[];
  const model=async(prompt,context)=>{
    calls.push(prompt.split(" ")[0]);
    const ids=JSON.parse(context).sources.map(s=>s.id);
    if(prompt.startsWith("Plan"))return "Change value to two.";
    if(prompt.startsWith("Return")){
      assert.ok(ids.includes("planner:plan"));
      return JSON.stringify({path:"value.js",oldText:"= 1",newText:"= 2"});
    }
    assert.ok(ids.includes("coder:diff") && ids.includes("tester:0"));
    assert.ok(!ids.includes("planner:plan"));
    return JSON.stringify({blocking:false,finding:"Verified exported value."});
  };
  assert.equal((await runTask(db,root,id,model,async diff=>diff.includes("+= 2"),()=>{})).status,"completed");
  assert.deepEqual(calls,["Plan","Return","Review"]);
});
