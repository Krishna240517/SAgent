import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrate } from "../dist/storage/migrations.js";
import { addDecision, addMessage, addPreference, createConversation, getConversation, listConversations, listPreferences, recentMessages, renameConversation } from "../dist/chat/store.js";
import { textDeltas } from "../dist/chat/stream.js";

test("chat history, title, and messages persist as separate records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, "global");
    const conversation = createConversation(db);
    addMessage(db, conversation.id, "user", "Hello SAgent");
    addMessage(db, conversation.id, "assistant", "Hello back");
    assert.equal(getConversation(db, conversation.id).title, "Hello SAgent");
    assert.deepEqual(recentMessages(db, conversation.id).map(({ content }) => content), ["Hello SAgent", "Hello back"]);
    renameConversation(db, conversation.id, "Renamed");
    assert.equal(listConversations(db)[0].title, "Renamed");
    assert.throws(() => renameConversation(db, conversation.id, " "), /Title/);
    addPreference(db, "Prefer short replies");
    assert.equal(listPreferences(db)[0].source, "user");
    addDecision(db, "Use SQLite locally");
    assert.equal(db.prepare("SELECT count(*) AS n FROM decisions").get().n, 1);
  } finally { db.close(); }
});

test("SSE text survives chunk boundaries and requires completion", async () => {
  const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
  const data = event({ type: "response.output_text.delta", delta: "Hello" }) + event({ type: "response.completed" });
  const chunks = [data.slice(0, 7), data.slice(7, 31), data.slice(31)];
  const response = new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }));
  const deltas = [];
  for await (const delta of textDeltas(response)) deltas.push(delta);
  assert.deepEqual(deltas, ["Hello"]);
  await assert.rejects(async () => {
    for await (const _ of textDeltas(new Response(event({ type: "response.output_text.delta", delta: "partial" })))) { /* consume */ }
  }, /before completion/);
});
