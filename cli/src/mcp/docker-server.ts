import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, copyFileSync, rmSync } from "node:fs";
import { homedir,tmpdir } from "node:os";
import path from "node:path";
import { discoverWorkspace,safeSourceFile } from "../repo/workspace.js";

const {SAGENT_DOCKER:bin,SAGENT_IMAGE:image,SAGENT_ROOT:root,SAGENT_DAEMON:daemon,HUB_PAT_TOKEN:token,SAGENT_HUB_USER:user}=process.env;
if(!bin || !image || !root || !daemon) throw new Error("Start this adapter through sagent mcp.");
delete process.env.HUB_PAT_TOKEN;
const server=new Server({name:"sagent-local-docker",version:"1"},{capabilities:{tools:{}}});
const names=["image_info","image_build","container_run","container_delete","image_push"];
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:names.map(name=>({name,inputSchema:{type:"object" as const,
  properties:{image:{const:image},...(name==="container_delete"?{id:{type:"string",pattern:"^[a-f0-9]{64}$"}}:{})},
  required:name==="container_delete"?["image","id"]:["image"],additionalProperties:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  if(!names.includes(params.name) || params.arguments?.image!==image) throw new Error("Invalid operation or image.");
  const tmp=mkdtempSync(path.join(tmpdir(),"sagent-docker-op-"));
  const cli=(args:string[],input?:string)=>execFileSync(bin,args,{encoding:"utf8",cwd:homedir(),timeout:45000,maxBuffer:64000,
    input,stdio:["pipe","pipe","pipe"]}).trim();
  try {
    const endpoint=cli(["--context","default","context","inspect","default","--format","{{.Endpoints.docker.Host}}"]);
    if(!/^(unix|npipe):\/\//.test(endpoint)) throw new Error("Expected a local engine.");
    const docker=(args:string[],input?:string)=>cli(["--config",tmp,"--host",endpoint,...args],input);
    if(docker(["info","--format","{{.ID}} {{.OSType}}"])!==daemon+" linux") throw new Error("Daemon mismatch.");
    let out="";
    switch(params.name){
      case "image_info":out=docker(["image","inspect","--format","{{.Id}} {{.Os}}/{{.Architecture}}",image]);break;
      case "image_build":{
        const snapshot=path.join(tmp,"build");mkdirSync(snapshot);
        const files=discoverWorkspace(root).files;
        if(files.length>5000 || !files.includes("Dockerfile")) throw new Error("Missing Dockerfile or snapshot limit exceeded.");
        let bytes=0;
        for(const file of files){
          const from=safeSourceFile(root,file);bytes+=statSync(from).size;
          if(bytes>128*1024*1024) throw new Error("Snapshot too large.");
          const dest=path.join(snapshot,file);mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(from,dest);
        }
        out=docker(["build","--network=none","--quiet","--tag",image,snapshot]);break;
      }
      case "container_run":out=docker(["run","--detach","--pull=never","--network=none","--read-only","--cap-drop=ALL",
        "--security-opt=no-new-privileges","--user=65532:65532","--memory=256m","--pids-limit=64","--cpus=1",
        "--log-opt","max-size=4m","--log-opt","max-file=1","--label","sagent.operation="+image,image]);break;
      case "container_delete":{
        const id=params.arguments.id;
        if(typeof id!=="string" || !/^[a-f0-9]{64}$/.test(id) ||
          docker(["inspect","--type=container","--format",'{{index .Config.Labels "sagent.operation"}}',id])!==image) throw new Error("Container scope mismatch.");
        out=docker(["rm","-f",id]);break;
      }
      case "image_push":
        if(!token || !user) throw new Error("Docker Hub credentials required.");
        writeFileSync(path.join(tmp,"config.json"),JSON.stringify({auths:{"https://index.docker.io/v1/":{auth:Buffer.from(user+":"+token).toString("base64")}}}),{mode:0o600});
        out=docker(["push",image]);break;
    }
    return {content:[{type:"text" as const,text:out}]};
  } catch {return {isError:true,content:[{type:"text" as const,text:"Docker operation failed."}]};}
  finally {rmSync(tmp,{recursive:true,force:true});}
});
await server.connect(new StdioServerTransport());
