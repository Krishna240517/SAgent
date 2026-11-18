import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Conversation, Message } from "../storage/records.js";
import type { AcceptedPreference, Decision } from "../storage/records.js";
import { atomic, queueUpsert } from "../sync/local.js";

export function createConversation(db: DatabaseSync): Conversation {
  const now = new Date().toISOString();
  const conversation = { id: randomUUID(), title: "New chat", created_at: now, updated_at: now };
  atomic(db, () => {
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(conversation.id, conversation.title, now, now);
    queueUpsert(db, "conversation", conversation);
  });
  return conversation;
}

export function getConversation(db: DatabaseSync, id: string): Conversation | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
}

export function listConversations(db: DatabaseSync): Conversation[] {
  return db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as Conversation[];
}

export function renameConversation(db: DatabaseSync, id: string, title: string): void {
  const clean = title.trim();
  if (!clean || clean.length > 120) throw new Error("Title must be 1–120 characters.");
  atomic(db, () => {
    const result = db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(clean, new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("Conversation not found.");
    queueUpsert(db, "conversation", getConversation(db, id)!);
  });
}

export function addMessage(db: DatabaseSync, conversationId: string, role: "user" | "assistant", content: string): Message {
  const message = { id: randomUUID(), conversation_id: conversationId, role, content, created_at: new Date().toISOString() };
  atomic(db, () => {
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(message.id, conversationId, role, content, message.created_at);
    db.prepare("UPDATE conversations SET updated_at = ?, title = CASE WHEN title = 'New chat' AND ? = 'user' THEN ? ELSE title END WHERE id = ?")
      .run(message.created_at, role, content.slice(0, 60), conversationId);
    queueUpsert(db, "message", message);
    queueUpsert(db, "conversation", getConversation(db, conversationId)!);
  });
  return message;
}

export function recentMessages(db: DatabaseSync, conversationId: string): Message[] {
  return (db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 40")
    .all(conversationId) as Message[]).reverse();
}

export function addPreference(db: DatabaseSync, content: string): AcceptedPreference {
  const clean = content.trim();
  if (!clean || clean.length > 500) throw new Error("Preference must be 1–500 characters.");
  const preference: AcceptedPreference = { id: randomUUID(), content: clean, source: "user", source_message_id: null, approved_at: new Date().toISOString() };
  atomic(db, () => {
    db.prepare("INSERT INTO accepted_preferences (id, content, source, source_message_id, approved_at) VALUES (?, ?, ?, ?, ?)")
      .run(preference.id, clean, preference.source, null, preference.approved_at);
    queueUpsert(db, "preference", preference);
  });
  return preference;
}

export function listPreferences(db: DatabaseSync): AcceptedPreference[] {
  return db.prepare("SELECT * FROM accepted_preferences ORDER BY approved_at DESC").all() as AcceptedPreference[];
}

export function activeDecisions(db: DatabaseSync): Decision[] {
  return db.prepare(`SELECT * FROM decisions d WHERE NOT EXISTS
    (SELECT 1 FROM decisions newer WHERE newer.supersedes_id = d.id) ORDER BY d.rowid DESC LIMIT 10`).all() as Decision[];
}

export function addDecision(db: DatabaseSync, content: string, supersedesId?: string): Decision {
  const clean = content.trim();
  if (!clean || clean.length > 10_000) throw new Error("Decision must be 1–10,000 characters.");
  const decision = { supersedes_id: supersedesId ?? null, id: randomUUID(), content: clean, source_message_id: null, created_at: new Date().toISOString() };
  atomic(db, () => {
    if (supersedesId && !db.prepare("SELECT 1 FROM decisions WHERE id = ?").get(supersedesId)) throw new Error("Original decision not found.");
    db.prepare("INSERT INTO decisions (id, content, source_message_id, created_at, supersedes_id) VALUES (?, ?, ?, ?, ?)")
      .run(decision.id, clean, null, decision.created_at, decision.supersedes_id);
    queueUpsert(db, "decision", decision);
  });
  return decision;
}
