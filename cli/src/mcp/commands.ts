import { Command } from "commander";
import { cancel, confirm, isCancel, password, text } from "@clack/prompts";
import { setup } from "./setup.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { openProjectStore } from "../storage/index.js";
import { connected,dispatch } from "./broker.js";
import { github,type Settings } from "./github.js";
import { dockerProfile,hub } from "./docker.js";
import { eks,kubernetes } from "./clusters.js";

const home=path.join(homedir(),".sagent");
function settings():Record<string,Settings>{
  const file=path.join(home,"mcp.json");
  if (!existsSync(file)) return {};
  const json=JSON.parse(readFileSync(file,"utf8"));
  if(!json || typeof json!=="object" || Array.isArray(json)) throw new Error("Invalid ~/.sagent/mcp.json.");
  return json;
}
function credential(name:string) {
  const file=process.env.SAGENT_MCP_ENV_FILE || path.join(home,".env");
  if (!path.isAbsolute(file)) throw new Error("SAGENT_MCP_ENV_FILE must be absolute.");
  const pat=path.join(home,"hub.pat");
  return process.env[name] || (name==="HUB_PAT_TOKEN" && existsSync(pat) ? readFileSync(pat,"utf8").trim() : "") ||
    (existsSync(file)?parseEnv(readFileSync(file,"utf8"))[name]:"") || "";
}
function profile(name:string,root:string) {
  const config=settings();
  if(!Object.hasOwn(config,name)) throw new Error("Connector is disabled in ~/.sagent/mcp.json.");
  const s=config[name]!;
  switch(name){
    case "github":return github(s,credential("SAGENT_GITHUB_MCP_TOKEN"));
    case "docker":return dockerProfile(s,root,credential("HUB_PAT_TOKEN"));
    case "hub":return hub(s,credential("HUB_PAT_TOKEN"));
    case "kubernetes":return kubernetes(s);
    case "eks":return eks(s);
    default:throw new Error("Unknown connector.");
  }
}
export const mcp=new Command("mcp").description("Run scoped infrastructure operations");
mcp.command("setup <connector>").description("Configure hub, eks, or kubernetes interactively").action(async(name:string)=>{
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Open an interactive terminal for connector setup.");
  const cancelled=Symbol();
  function answer(value:string|symbol) {
    if(isCancel(value) || typeof value!=="string") throw cancelled;
    return value;
  }
  try {
    await setup(home,name,settings(),async(message,initialValue)=>answer(await text({message,initialValue,validate:v=>v?.trim()?undefined:"Required"})),
      async()=>answer(await password({message:"Docker Hub PAT (leave blank to use an existing token)"})),
      ()=>credential("HUB_PAT_TOKEN"));
  } catch(e) {
    if(e===cancelled) { cancel("Setup cancelled."); return; }
    throw e;
  }
  console.log("Saved read-only settings. List available actions with sagent mcp list "+name+".");
  if(name==="hub" && process.env.HUB_PAT_TOKEN) console.log("The exported HUB_PAT_TOKEN takes precedence over the saved PAT.");
});
mcp.command("list [connector]").description("List enabled connectors or available actions").action(async(name?:string)=>{
  if(!name) { console.log(Object.keys(settings()).filter(n=>["github","docker","hub","kubernetes","eks"].includes(n)).join("\n"));return; }
  const p=profile(name,process.cwd());
  await connected(p,async(_,schemas)=>{
    console.log(p.target);
    for(const [key,op] of Object.entries(p.actions)) if((!op.write || p.writes) && schemas.has(op.tool)) console.log(key,op.write?"(approval required)":"(read)");
  });
});
export async function callMcp(name:string,key:string,raw:string,readOnly=false) {
  const opened=openProjectStore();
  try{
    const p=profile(name,opened.link.local_path);
    if(!Object.hasOwn(p.actions,key)) throw new Error("Unknown MCP action.");
    if(readOnly && p.actions[key]!.write) throw new Error("Context requires a read-only MCP action.");
    if(raw.length>16000) throw new Error("Arguments too large.");
    const args=JSON.parse(raw);
    const id=randomUUID(),db=opened.db;
    db.prepare("INSERT INTO tool_actions (id,operation,path,before_sha,after_sha,diff,status,created_at) VALUES (?,?,?,'','','','pending',?)")
      .run(id,"mcp:"+name+"."+key,p.target,new Date().toISOString());
    const audit=(status:string)=>{db.prepare("UPDATE tool_actions SET status=? WHERE id=?").run(status,id);};
    console.log("Action",id,p.target);
    try {
      const result=await connected(p,(client,schemas)=>dispatch(client,p,schemas,key,args,async preview=>{
        if(!process.stdin.isTTY || !process.stdout.isTTY) return false;
        console.log(preview);
        return (await confirm({message:"Authorize this operation?",initialValue:false}))===true;
      },audit));
      return { ...result,id };
    } catch {audit("failed");throw new Error("MCP operation failed. Check target, credentials, permissions and tool schema. Inspect the target before retrying a write.");}
  } finally {opened.db.close();}
}
mcp.command("call <connector> <action> [json]").description("Call one enabled action with JSON arguments").action(async(name:string,key:string,raw="{}")=>{
  const result=await callMcp(name,key,raw);
  if(result.status==="rejected") process.exitCode=1;
  console.log(result.status,result.untrusted || "");
});
