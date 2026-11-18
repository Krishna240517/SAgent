import { Command } from "commander";
import { API_URL } from "../config.js";
import { getStoredToken } from "../commands/auth/token.js";
import { addDecision, addMessage, createConversation, getConversation, listConversations } from "../chat/store.js";
import { textDeltas } from "../chat/stream.js";
import { openProjectStore } from "../storage/index.js";
import type { Decision, Message } from "../storage/records.js";
import { SymbolIndex } from "../repo/symbols.js";
import { buildContext, collectEvidence, type ContextSource } from "./engine.js";
import { latestSummary, summarizeHistory } from "./memory.js";

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

export const code = new Command("code").description("Ask read-only questions about this repository");
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
      const decisions = db.prepare("SELECT * FROM decisions ORDER BY rowid DESC LIMIT 10").all() as Decision[];
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
code.command("list").description("List local coding conversations").action(() => {
  const opened = openProjectStore();
  try { for (const item of listConversations(opened.db)) console.log(`${item.id}  ${item.title}`); }
  finally { opened.db.close(); }
});
code.command("decide <text>").description("Record an approved project decision").action((text: string) => {
  const opened = openProjectStore();
  try { console.log(`Saved project decision ${addDecision(opened.db, text).id}`); }
  finally { opened.db.close(); }
});
