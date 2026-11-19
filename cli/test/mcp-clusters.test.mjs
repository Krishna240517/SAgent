import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {kubernetes,eks} from "../dist/mcp/clusters.js";
test("cluster operations have fixed contexts, namespaces, and operation kinds",()=>{
 const kube=kubernetes({cluster:"demo",context:"local",account:"user",namespace:"app",kubeconfig:path.resolve("fixture")});
 assert.equal(kube.writes,false);
 const applied=kube.actions.applyConfig.bind({name:"settings",data:{mode:"test"}});
 assert.equal(JSON.parse(applied.resource).metadata.namespace,"app");
 assert.equal(JSON.parse(applied.resource).kind,"ConfigMap");
 assert.deepEqual(kube.actions.podIdentity.bind({name:"worker"}).command,["id"]);
 assert.ok(kube.actions.secretExists.omitOutput);
 const aws=eks({profile:"dev",region:"us-east-1",account:"123456789012",cluster:"demo",namespace:"app"});
 assert.equal(aws.writes,false);
 assert.deepEqual(aws.actions.deletePod.bind({name:"worker"}),{name:"worker",cluster_name:"demo",namespace:"app",api_version:"v1",kind:"Pod",operation:"delete"});
});
