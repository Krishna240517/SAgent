import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pinned } from "./broker.js";
import { hub } from "./docker.js";
import { eks, kubernetes } from "./clusters.js";
import type { Settings } from "./github.js";

const questions = {
  hub: {account:"Docker Hub username", repository:"Repository", server:"Absolute path to the Docker Hub MCP server entry point", sha256:"Trusted SHA-256 of that file"},
  eks: {profile:"Configured AWS CLI profile", account:"12-digit AWS account ID", region:"AWS region", cluster:"EKS cluster", namespace:"Kubernetes namespace", aws:"Absolute path to AWS CLI", server:"Absolute path to AWS Labs EKS MCP server", sha256:"Trusted SHA-256 of that executable"},
  kubernetes: {kubeconfig:"Absolute path to kubeconfig", context:"Kubeconfig context", cluster:"Cluster name in kubeconfig", namespace:"Kubernetes namespace", account:"Expected Kubernetes username or service account", kubectl:"Absolute path to kubectl", server:"Absolute path to Kubernetes MCP server", sha256:"Trusted SHA-256 of that executable"}
};

function save(file:string, value:string) {
  const tmp = file+"."+randomUUID()+".tmp";
  try {
    writeFileSync(tmp,value,{flag:"wx",mode:0o600});
    renameSync(tmp,file);
  } finally { rmSync(tmp,{force:true}); }
}

export async function setup(home:string, name:string, profiles:Record<string,Settings>,
  ask:(label:string, initial?:string)=>Promise<string>, askToken:()=>Promise<string>, currentToken:()=>string) {
  if (name!=="hub" && name!=="eks" && name!=="kubernetes") throw new Error("Choose hub, eks, or kubernetes.");
  const config:Settings={writes:"false"};
  for(const [key,label] of Object.entries(questions[name])) config[key]=(await ask(label,profiles[name]?.[key])).trim();
  config.sha256=config.sha256!.toLowerCase();
  pinned(config.server!,config.sha256);
  for(const key of ["kubeconfig","kubectl","aws"]) {
    if(key in config && (!path.isAbsolute(config[key]!) || !existsSync(config[key]!) || !statSync(config[key]!).isFile())) throw new Error("Invalid file for "+key);
  }
  let token="";
  if(name==="hub") {
    token=await askToken();
    if(token && !/^[A-Za-z0-9_.-]+$/.test(token)) throw new Error("Invalid Docker Hub PAT.");
    hub(config,token || currentToken());
  } else if(name==="eks") eks(config);
  else kubernetes(config);
  mkdirSync(home,{recursive:true,mode:0o700});
  if(token) save(path.join(home,"hub.pat"),token);
  save(path.join(home,"mcp.json"),JSON.stringify({...profiles,[name]:config},null,2)+"\n");
}
