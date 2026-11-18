import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { API_URL } from "../config.js";
import { getStoredToken } from "../commands/auth/token.js";
import { openGlobalStore } from "../storage/index.js";
import { addDecision, addMessage, addPreference, createConversation, getConversation, listConversations, listPreferences, recentMessages, renameConversation } from "./store.js";
import { textDeltas } from "./stream.js";
import { syncNow } from "../sync/client.js";

async function startChat(id?: string, fresh = false) {
  const db = openGlobalStore();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let controller: AbortController | null = null;
  let closed = false;
  rl.on("close", () => { closed = true; });
  rl.on("SIGINT", () => controller ? controller.abort() : rl.close());
  try {
    const login = await getStoredToken();
    if (login) {
      try { await syncNow(db, login.access_token); }
      catch (error) { console.error(`Sync unavailable: ${error instanceof Error ? error.message : error}`); }
    }
    const conversation = id ? getConversation(db, id) : fresh ? createConversation(db) : listConversations(db)[0] || createConversation(db);
    if (!conversation) throw new Error("Conversation not found.");
    console.log(`Chat: ${conversation.title} (${conversation.id})`);
    for (const message of recentMessages(db, conversation.id).slice(-20)) {
      console.log(`${message.role}: ${message.content}`);
    }
    const { entrypoint } = await import("@langchain/langgraph");
    while (!closed) {
      let prompt: string;
      try { prompt = (await rl.question("you> ")).trim(); } catch { break; }
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;
      const token = await getStoredToken();
      if (!token) { console.error("Run sagent login before sending a message."); continue; }
      addMessage(db, conversation.id, "user", prompt);
      controller = new AbortController();
      let answer = "";
      try {
        const signal = controller.signal;
        const companion = entrypoint("companion", async (messages: {role:string; content:string}[]) => {
          const response = await fetch(`${API_URL}/api/chat/stream`, {
            method: "POST",
            headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
            body: JSON.stringify({
              messages,
              preferences: listPreferences(db).slice(0, 20).map(({ content }) => content),
            }),
            signal,
          });
          process.stdout.write("sagent> ");
          for await (const delta of textDeltas(response)) { process.stdout.write(delta); answer += delta; }
          return answer;
        });
        await companion.invoke(recentMessages(db, conversation.id).map(({role,content})=>({role,content})), { signal });
        process.stdout.write("\n");
        if (answer) addMessage(db, conversation.id, "assistant", answer);
      } catch (error) {
        process.stdout.write("\n");
        console.error(controller.signal.aborted ? "Generation canceled." : error instanceof Error ? error.message : "Chat failed.");
      } finally {
        controller = null;
        try { await syncNow(db, token.access_token); }
        catch (error) { console.error(`Sync unavailable: ${error instanceof Error ? error.message : error}`); }
      }
    }
  } finally {
    rl.close();
    db.close();
  }
}

export const chat = new Command("chat").description("Talk with SAgent").action(() => startChat());
chat.command("new").description("Start a new conversation").action(() => startChat(undefined, true));
chat.command("open <id>").description("Continue a conversation").action((id: string) => startChat(id));
chat.command("list").description("List conversations").action(async () => {
  const db = openGlobalStore();
  try {
    const token = await getStoredToken();
    if (token) {
      try { await syncNow(db, token.access_token); }
      catch (error) { console.error(`Sync unavailable: ${error instanceof Error ? error.message : error}`); }
    }
    for (const item of listConversations(db)) console.log(`${item.id}  ${item.title}`);
  }
  finally { db.close(); }
});
chat.command("rename <id> <title>").description("Rename a conversation").action((id: string, title: string) => {
  const db = openGlobalStore();
  try { renameConversation(db, id, title); }
  finally { db.close(); }
});
chat.command("remember <preference>").description("Save an approved preference").action((content: string) => {
  const db = openGlobalStore();
  try { console.log(`Saved preference ${addPreference(db, content).id}`); }
  finally { db.close(); }
});
chat.command("preferences").description("List approved preferences").action(() => {
  const db = openGlobalStore();
  try { for (const item of listPreferences(db)) console.log(`${item.id}  ${item.content}`); }
  finally { db.close(); }
});
chat.command("decide <decision>").description("Record a decision").action((content: string) => {
  const db = openGlobalStore();
  try { console.log(`Saved decision ${addDecision(db, content).id}`); }
  finally { db.close(); }
});
