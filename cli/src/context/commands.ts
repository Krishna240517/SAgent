import { activeDecisions } from "../chat/store.js";
import { Command } from "commander";
import { confirm, isCancel } from "@clack/prompts";
import { API_URL } from "../config.js";
import { getStoredToken } from "../commands/auth/token.js";
import { addDecision, addMessage, createConversation, getConversation, listConversations } from "../chat/store.js";
import { textDeltas } from "../chat/stream.js";
import { openProjectStore } from "../storage/index.js";
import type { Message } from "../storage/records.js";
import { SymbolIndex } from "../repo/symbols.js";
import { buildContext, collectEvidence, type ContextSource } from "./engine.js";
import { latestSummary, summarizeHistory } from "./memory.js";
import { executeFix } from "../edit/workflow.js";
import { recoverActions } from "../edit/patch.js";

async function model(token: string, question: string, context?: string, echo = true): Promise<string> {
  const response = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], context }),
  });
  let answer = "";
  for await (const delta of textDeltas(response)) {
    if (echo) process.stdout.write(delta);
    answer += delta;
    if (answer.length > 20_000) throw new Error("Model response exceeded the local limit.");
  }
  if (echo) process.stdout.write("\n");
  return answer;
}

export const code = new Command("code").description("Ask about or safely edit this repository");
code.command("ask <question>").description("Answer with bounded local source context").option("--new", "Start a new coding conversation")
  .option("--conversation <id>", "Continue a specific coding conversation")
  .action(async (question: string, options: { new?: boolean; conversation?: string }) => {
    const token = await getStoredToken();
    if (!token) throw new Error("Run sagent login first.");
    const opened = openProjectStore();
    const db = opened.db;
    try {
      const conversation = options.conversation ? getConversation(db, options.conversation) : options.new ? createConversation(db) : listConversations(db)[0] || createConversation(db);
      if (!conversation) throw new Error("Coding conversation not found.");
      const current = addMessage(db, conversation.id, "user", question);
      await summarizeHistory(db, conversation.id, (prompt) => model(token.access_token, prompt, undefined, false));
      const index = new SymbolIndex(opened.link.local_path);
      await index.refresh();
      const decisions = activeDecisions(db);
      const prior = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id != ? ORDER BY rowid DESC LIMIT 10").all(conversation.id, current.id) as Message[];
      const summary = latestSummary(db, conversation.id);
      const evidence = collectEvidence(opened.link.local_path, question, index);
      const sources: ContextSource[] = [
        ...decisions.map((item) => ({ id: `decision:${item.id}`, kind: "decision" as const, content: item.content })),
        ...(summary ? [{ id: `summary:${summary.id}`, kind: "summary" as const, content: summary.content }] : []),
        ...evidence,
        ...prior.reverse().map((item) => ({ id: `message:${item.id}`, kind: "message" as const, content: `${item.role}: ${item.content}` })),
      ];
      const context = buildContext(question, sources, "coder");
      const answer = await model(token.access_token, question, context.context);
      if (answer) addMessage(db, conversation.id, "assistant", answer);
      const paths = context.sourceIds.filter((item) => item.startsWith("file:") || item.startsWith("search:")).slice(0, 8);
      if (paths.length) console.log(`Sources: ${paths.join(", ")}`);
      console.log(`Conversation: ${conversation.id}`);
    } finally { db.close(); }
  });
code.command("fix <task>").description("Propose one edit, request approval, then verify it in Docker").action(async (task: string) => {
  if (!process.stdin.isTTY) throw new Error("An interactive terminal is required to approve source edits.");
  const token = await getStoredToken();
  if (!token) throw new Error("Run sagent login first.");
  const opened = openProjectStore();
  try {
    const result = await executeFix(opened.db, opened.link.local_path, task,
      (prompt, context) => model(token.access_token, prompt, context, false),
      async (diff) => {
        console.log(diff);
        const answer = await confirm({ message: "Apply this patch to the workspace?", initialValue: false });
        return !isCancel(answer) && answer;
      });
    if (result.status === "rejected") return console.log("Patch declined; source files were not changed.");
    console.log(`Patch action: ${result.actionId}`);
    for (const check of result.checks) console.log(`${check.kind}: ${check.result.status}\n${check.result.output}`);
    if (result.status !== "verified") {
      process.exitCode = 1;
      console.log("Edit applied, but verification did not pass. Inspect the action log and fix the failure.");
    } else console.log("Edit verified in the Docker sandbox.");
  } finally { opened.db.close(); }
});
code.command("actions").description("Show recent coding tool actions and recovery status").action(() => {
  const opened = openProjectStore();
  try {
    for (const item of recoverActions(opened.db, opened.link.local_path)) console.log(`${item.created_at} ${item.id} ${item.operation} ${item.status} ${item.path}`);
  } finally { opened.db.close(); }
});
code.command("action <id>").description("Show a coding action's diff and check output").action((id: string) => {
  const opened = openProjectStore();
  try {
    const action = recoverActions(opened.db, opened.link.local_path).find((item) => item.id === id);
    if (!action) throw new Error("Coding action not found in the recent log.");
    console.log(`${action.operation}: ${action.status}\n${action.diff}${action.output}`);
  } finally { opened.db.close(); }
});
code.command("list").description("List local coding conversations").action(() => {
  const opened = openProjectStore();
  try { for (const item of listConversations(opened.db)) console.log(`${item.id}  ${item.title}`); }
  finally { opened.db.close(); }
});
code.command("decide <text>").description("Record an approved project decision").option("--supersedes <id>", "Replace an earlier decision").action((text: string, options: { supersedes?: string }) => {
  const opened = openProjectStore();
  try { console.log(`Saved project decision ${addDecision(opened.db, text, options.supersedes).id}`); }
  finally { opened.db.close(); }
});

async function codingRun(value:string, resume:boolean, prepare=false) {
  if (!process.stdin.isTTY) throw new Error("Open an interactive terminal to approve edits.");
  const token=await getStoredToken();
  if (!token) throw new Error("Run sagent login first.");
  const opened=openProjectStore();
  try {
    const {runTask,startTask,queueTask}=await import("./runs.js");
    const {codingRoles}=await import("./roles.js");
    const {atomic}=await import("../sync/local.js");
    const invoke=(prompt:string,context:string)=>model(token.access_token,prompt,context,false);
    const ask=async(message:string)=> (await confirm({message,initialValue:false}))===true;
    const id=resume?value:startTask(opened.db,opened.link.local_path,value);
    console.log("Task "+id);
    if(prepare) {
      const plan=await codingRoles(opened.db,opened.link.local_path,invoke,async()=>false,async()=>{throw new Error("Planning only.");}).plan(value);
      console.log(plan);
      if(plan.length>2000) throw new Error("Plan exceeds the 2,000-character handoff limit.");
      if(await ask("Save this plan as the approved summary for project sync?")) atomic(opened.db,()=>{
        opened.db.prepare("UPDATE tasks SET summary=? WHERE id=?").run(plan,id);queueTask(opened.db,id);
      });
      return;
    }
    const result=await runTask(opened.db,opened.link.local_path,id,invoke,async diff=>{
      console.log(diff);return ask("Apply this exact patch?");
    },(role,detail)=>console.log(role+"\n"+detail));
    console.log(result.status+" "+result.detail);
    if(result.status==="failed") process.exitCode=1;
  } finally {opened.db.close();}
}
code.command("run <task>").description("Run Planner, Coder, Tester and Reviewer").option("--prepare","Prepare an approved plan for another checkout")
  .action((task:string,options:{prepare?:boolean})=>codingRun(task,false,options.prepare));
code.command("resume <id>").description("Resume a checkpointed coding task").action((id:string)=>codingRun(id,true));
code.command("tasks").description("List project coding tasks").action(()=>{
  const opened=openProjectStore();
  try {for(const row of opened.db.prepare("SELECT id,status,title FROM tasks ORDER BY rowid DESC").all()) console.log(row.id,row.status,row.title);}
  finally {opened.db.close();}
});
