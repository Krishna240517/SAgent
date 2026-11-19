import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setup } from "../dist/mcp/setup.js";

test("interactive setup preserves profiles and keeps the PAT out of connector settings",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sagent-setup-"));
  t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,"fixture");
  fs.writeFileSync(file,"fixture");
  const pin=createHash("sha256").update("fixture").digest("hex");
  const configFile=path.join(dir,"mcp.json");
  let profiles={github:{account:"existing"}};
  for(const [name,values] of [
    ["hub",["alice","demo",file,pin]],
    ["eks",["dev","123456789012","us-east-1","demo","app",file,file,pin]],
    ["kubernetes",[file,"dev@cluster","cluster","app","system:serviceaccount:app:sagent",file,file,pin.toUpperCase()]]
  ]){
    await setup(dir,name,profiles,async()=>values.shift(),async()=>{
      assert.equal(name,"hub");return "fixture-pat";
    },()=>assert.fail());
    profiles=JSON.parse(fs.readFileSync(configFile,"utf8"));
    assert.equal(profiles[name].writes,"false");
  }
  assert.deepEqual(Object.keys(profiles),["github","hub","eks","kubernetes"]);
  assert.ok(!JSON.stringify(profiles).includes("fixture-pat"));
  assert.equal(fs.readFileSync(path.join(dir,"hub.pat"),"utf8"),"fixture-pat");
  if(process.platform!=="win32") assert.equal(fs.statSync(path.join(dir,"hub.pat")).mode & 0o777,0o600);
  await assert.rejects(setup(dir,"hub",profiles,async()=>{throw Error("cancelled");},()=>assert.fail(),()=>assert.fail()),/cancelled/);
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile)),profiles);
});
