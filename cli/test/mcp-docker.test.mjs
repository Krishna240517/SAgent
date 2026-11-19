import test from "node:test";
import assert from "node:assert/strict";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {stdio,discover} from "../dist/mcp/broker.js";
import {dockerProfile,hub} from "../dist/mcp/docker.js";
import {fileURLToPath} from "node:url";
test("packaged Docker adapter negotiates stdio and exposes only configured reads",async()=>{
 const p=dockerProfile({daemon:"fixture",account:"library",repository:"node",tag:"22-alpine"},".","");
 const client=new Client({name:"fixture",version:"1"});
 try{
  await client.connect(stdio(process.execPath,[fileURLToPath(new URL("../dist/mcp/docker-server.js",import.meta.url))],
   {SAGENT_IMAGE:"docker.io/library/node:22-alpine",SAGENT_DOCKER:process.execPath,SAGENT_ROOT:process.cwd(),SAGENT_DAEMON:"fixture"}));
  assert.deepEqual([...await discover(client,p)].map(([name])=>name),["image_info"]);
 }finally{await client.close();}
 const h=hub({account:"team",repository:"demo"},"test");
 assert.deepEqual(h.actions.create.bind({}),{namespace:"team",name:"demo",is_private:true});
});
