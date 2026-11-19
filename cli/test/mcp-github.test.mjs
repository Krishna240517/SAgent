import assert from "node:assert/strict";
import test from "node:test";
import {github} from "../dist/mcp/github.js";
import {dispatch} from "../dist/mcp/broker.js";
test("issue to branch to PR stays on the configured repository and branch", async()=>{
  const p=github({account:"alice",owner:"team",repo:"demo",branch:"feature",base:"main",writes:"true"},"fixture");
  p.verify=async()=>{};
  const calls=[];
  const client={callTool:async req=>{calls.push(req);return {content:[]};}};
  const schemas=new Map(Object.values(p.actions).map(op=>[op.tool,{type:"object"}]));
  for(const [op,args] of [["issue",{issue_number:2}],["branch",{}],["push",{message:"Fix",files:[{path:"a.js",content:"ok"}]}],["openPR",{title:"Fix #2",body:"Tested"}]])
    await dispatch(client,p,schemas,op,args,async msg=>msg.includes("team/demo"),()=>{});
  assert.deepEqual(calls.map(c=>c.name),["issue_read","create_branch","push_files","create_pull_request"]);
  assert.ok(calls.every(c=>c.arguments.owner==="team" && c.arguments.repo==="demo"));
  assert.equal(calls.at(-1).arguments.head,"feature");
});
