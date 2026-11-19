import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { action,pinned,stdio,type Profile } from "./broker.js";
import { field,type Settings } from "./github.js";
import path from "node:path";

function inspect(binary:string,args:string[],env:Record<string,string>) {
  if(!path.isAbsolute(binary)) throw new Error("Configure the absolute provider CLI path.");
  return execFileSync(binary,args,{cwd:homedir(),env:{...getDefaultEnvironment(),...env},encoding:"utf8",timeout:10000,
    maxBuffer:64000,stdio:["ignore","pipe","ignore"]}).trim();
}
export function kubernetes(s:Settings):Profile {
  const kubeName=/^[a-zA-Z0-9][a-zA-Z0-9@.:/_-]{0,252}$/;
  const context=field(s,"context",kubeName),cluster=field(s,"cluster",kubeName),namespace=field(s,"namespace");
  const account=field(s,"account",/^[\w.:-]{1,200}$/);
  if(!path.isAbsolute(s.kubeconfig||"")) throw new Error("Configure an absolute kubeconfig path.");
  const scope={context,namespace}, writes=s.writes==="true";
  const get=(...args:string[])=>inspect(s.kubectl!,["--kubeconfig",s.kubeconfig!,"--context",context,...args],{});
  return {target:account+" @ "+cluster+" / context "+context+" / namespace "+namespace,writes,
    transport:()=>stdio(pinned(s.server!,s.sha256!),["--kubeconfig",s.kubeconfig!,...(writes?[]:["--read-only"])]),
    verify:async()=>{
      const cfg=JSON.parse(get("config","view","--minify","-o","json"));
      if(cfg.contexts?.[0]?.name!==context || cfg.contexts[0].context.cluster!==cluster ||
        JSON.parse(get("auth","whoami","-o","json")).status?.userInfo?.username!==account) throw new Error("Kubernetes target mismatch.");
      // kubectl exits 1 for a valid RBAC denial.
      try {if(get("auth","can-i","list","pods","--all-namespaces")==="yes") throw new Error("Use a namespace-scoped identity.");}
      catch(e){if((e as {stdout?:string}).stdout?.trim()!=="no") throw e;}
    },
    actions:{
      pods:action("pods_list_in_namespace",[],{...scope,limit:20}),
      deletePod:action("pods_delete",["name"],scope,true), podIdentity:action("pods_exec",["name"],{...scope,command:["id"]},true),
      secretExists:{...action("resources_get",["name"],{...scope,apiVersion:"v1",kind:"Secret"},true),omitOutput:true},
      applyConfig:{tool:"resources_create_or_update",fields:["name","data"],write:true,bind:args=>{
        if(typeof args.name!=="string" || !/^[a-z0-9][a-z0-9.-]{0,62}$/.test(args.name) || !args.data || typeof args.data!=="object" ||
          Array.isArray(args.data) || !Object.entries(args.data).every(([k,v])=>/^[\w.-]+$/.test(k)&&typeof v==="string")) throw new Error("Invalid ConfigMap.");
        return {context,resource:JSON.stringify({apiVersion:"v1",kind:"ConfigMap",metadata:{name:args.name,namespace},data:args.data})};
      }}
    }};
}
export function eks(s:Settings):Profile {
  const profile=field(s,"profile"),region=field(s,"region"),account=field(s,"account",/^\d{12}$/);
  const cluster=field(s,"cluster"),namespace=field(s,"namespace"),writes=s.writes==="true";
  const env={AWS_PROFILE:profile,AWS_REGION:region,AWS_DEFAULT_REGION:region,AWS_EC2_METADATA_DISABLED:"true"};
  const scope={cluster_name:cluster,namespace,kind:"Pod",api_version:"v1"};
  return {target:account+" / "+profile+" / "+region+" / "+cluster+" / "+namespace,writes,
    transport:()=>stdio(pinned(s.server!,s.sha256!),writes?["--allow-write"]:[],env),
    verify:async()=>{
      const identity=JSON.parse(inspect(s.aws!,["sts","get-caller-identity","--profile",profile,"--region",region,"--output","json"],env));
      if(identity.Account!==account) throw new Error("AWS account mismatch.");
    },
    actions:{pods:action("list_k8s_resources",[],scope),pod:action("manage_k8s_resource",["name"],{...scope,operation:"read"}),
      deletePod:action("manage_k8s_resource",["name"],{...scope,operation:"delete"},true)}
  };
}
