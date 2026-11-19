import { fileURLToPath } from "node:url";
import { action, pinned, stdio, type Profile } from "./broker.js";
import { field, type Settings } from "./github.js";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

export function hub(s:Settings, token:string):Profile {
  const account=field(s,"account"), repository=field(s,"repository"), scope={namespace:account,repository};
  if(!token) throw new Error("Configure HUB_PAT_TOKEN.");
  return {secrets:[token],target:account+" @ docker.io/"+account+"/"+repository,writes:s.writes==="true",
    transport:()=>stdio(process.execPath,[pinned(s.server!,s.sha256!), "--transport=stdio","--username="+account],{HUB_PAT_TOKEN:token}),
    verify:async()=>{
      const response=await fetch("https://hub.docker.com/v2/auth/token",{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
        headers:{"content-type":"application/json"},body:JSON.stringify({identifier:account,secret:token})});
      if(!response.ok || !(await response.json() as {access_token?:string}).access_token) throw new Error("Docker Hub account or credential rejected.");
    },actions:{
      tags:action("listRepositoryTags",[],{...scope,page_size:20}), info:action("getRepositoryInfo",[],scope),
      create:action("createRepository",["description"],{namespace:account,name:repository,is_private:true},true),
      update:action("updateRepositoryInfo",["description"],scope,true)
    }};
}

export function dockerProfile(s:Settings, root:string, token:string):Profile {
  const daemon=field(s,"daemon"), account=field(s,"account"), repository=field(s,"repository"), tag=field(s,"tag");
  const image="docker.io/"+account+"/"+repository+":"+tag;
  const binary=()=>pinned(s.docker!,s.dockerSha256!);
  const verify=()=>{
    const read=(args:string[])=>execFileSync(binary(),["--context","default",...args],{cwd:homedir(),encoding:"utf8",timeout:10000,stdio:["ignore","pipe","ignore"]}).trim();
    if(!/^(unix|npipe):\/\//.test(read(["context","inspect","default","--format","{{.Endpoints.docker.Host}}"])) ||
      read(["info","--format","{{.ID}} {{.OSType}}"])!==daemon+" linux") throw new Error("Docker daemon identity or context mismatch.");
  };
  const fixed={image};
  return {secrets:[token],target:"local daemon "+daemon+" / "+image,writes:s.writes==="true",verify:async()=>verify(),
    transport:()=>stdio(process.execPath,[fileURLToPath(new URL("./docker-server.js",import.meta.url))],
      {SAGENT_DOCKER:binary(),SAGENT_ROOT:root,SAGENT_IMAGE:image,SAGENT_DAEMON:daemon,SAGENT_HUB_USER:account,HUB_PAT_TOKEN:token}),
    actions:{inspect:action("image_info",[],fixed),build:action("image_build",[],fixed,true),run:action("container_run",[],fixed,true),
      delete:action("container_delete",["id"],fixed,true),push:action("image_push",[],fixed,true)}};
}
