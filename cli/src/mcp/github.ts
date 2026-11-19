import { action, githubHTTP, type Profile } from "./broker.js";

export type Settings = Record<string, string>;
export function field(s: Settings, key: string, pattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/) {
  const value = s[key];
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("Missing or invalid setting: "+key);
  return value;
}
export function github(s: Settings, token: string): Profile {
  const account=field(s,"account"), owner=field(s,"owner"), repo=field(s,"repo");
  const branch=field(s,"branch"), base=field(s,"base");
  if (base===branch || !token) throw new Error("Configure a distinct working branch and GitHub token.");
  const repository={owner,repo};
  return {secrets:[token],target:account+" @ github.com/"+owner+"/"+repo+" "+branch+" -> "+base, writes:s.writes==="true",
    transport:()=>githubHTTP(token),
    verify:async()=>{
      const response=await fetch("https://api.github.com/user",{headers:{authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(10000)});
      if(!response.ok || (await response.json() as {login:string}).login?.toLowerCase()!==account.toLowerCase()) throw new Error("GitHub identity mismatch or credential expired.");
    },
    actions:{
      repository:action("get_file_contents",[],{...repository,path:"/",ref:"refs/heads/"+base}),
      issue:action("issue_read",["issue_number"],{...repository,method:"get"}),
      pr:action("pull_request_read",["pullNumber"],{...repository,method:"get"}),
      createIssue:action("issue_write",["title","body"],{...repository,method:"create"},true),
      updateIssue:action("issue_write",["issue_number","title","body"],{...repository,method:"update"},true),
      branch:action("create_branch",[],{...repository,branch,from_branch:base},true),
      push:action("push_files",["files","message"],{...repository,branch},true),
      openPR:action("create_pull_request",["title","body"],{...repository,head:branch,base},true)
    }
  };
}
