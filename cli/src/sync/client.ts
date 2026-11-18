import type { DatabaseSync } from "node:sqlite";
import { API_URL } from "../config.js";
import { atomic, queueUpsert } from "./local.js";

type Kind = "conversation" | "message" | "decision" | "preference" | "task";
type Event = { revision: string; kind: Kind; recordId: string; payload: Record<string, any> };
type Outbox = { id: string; entity_type: Kind; entity_id: string; payload_json: string };

function revision(db: DatabaseSync, kind: string, id: string): string {
  return (db.prepare("SELECT revision FROM sync_revisions WHERE entity_type = ? AND entity_id = ?").get(kind, id) as { revision: string } | undefined)?.revision || "0";
}

function setRevision(db: DatabaseSync, kind: string, id: string, value: string) {
  db.prepare("INSERT INTO sync_revisions VALUES (?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET revision = excluded.revision")
    .run(kind, id, value);
}

export function localRecord(db: DatabaseSync, kind: Kind, id: string): Record<string, any> | undefined {
  const table = { conversation: "conversations", message: "messages", decision: "decisions", preference: "accepted_preferences", task: "tasks" }[kind];
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, any> | undefined;
}

function applyRecord(db: DatabaseSync, event: Event) {
  const item = event.payload;
  if (item.id !== event.recordId) throw new Error("Sync record ID mismatch.");
  switch (event.kind) {
    case "task":
      db.prepare(`INSERT INTO tasks (id,title,status,created_at,updated_at,revision,workspace_hash,private_required,summary)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,
        private_required=excluded.private_required,summary=excluded.summary`)
        .run(item.id,item.title,item.status,item.created_at,item.updated_at,item.revision,item.workspace_hash,item.private_required,item.summary);
      break;
    case "conversation":
      db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at")
        .run(item.id, item.title, item.created_at, item.updated_at);
      break;
    case "message":
      db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content")
        .run(item.id, item.conversation_id, item.role, item.content, item.created_at);
      break;
    case "decision":
      db.prepare("INSERT INTO decisions (id,content,source_message_id,created_at,supersedes_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, supersedes_id = excluded.supersedes_id")
        .run(item.id, item.content, item.source_message_id, item.created_at, item.supersedes_id ?? null);
      break;
    case "preference":
      db.prepare("INSERT INTO accepted_preferences VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content")
        .run(item.id, item.content, item.source, item.source_message_id, item.approved_at);
  }
}

async function request(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}/api/sync${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
}

export function bindSyncAccount(db: DatabaseSync, userId: string) {
  atomic(db, () => {
    const existing = db.prepare("SELECT value FROM sync_state WHERE key = 'user_id'").get() as { value: string } | undefined;
    if (existing && existing.value !== userId) throw new Error("This local history belongs to another account. Use its original login or a separate SAgent home.");
    if (!existing) db.prepare("INSERT INTO sync_state VALUES ('user_id', ?)").run(userId);
  });
}

export async function syncNow(db: DatabaseSync, token: string, projectId?: string): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  const sessionResponse = await fetch(`${API_URL}/api/auth/get-session`, { headers: { authorization: `Bearer ${token}` } });
  if (!sessionResponse.ok) throw new Error(`Session check failed (${sessionResponse.status}).`);
  const session = await sessionResponse.json() as { user?: { id?: string } } | null;
  if (!session?.user?.id) throw new Error("Session expired. Run sagent login.");
  bindSyncAccount(db, session.user.id);
  let pushed = 0, pulled = 0, conflicts = 0;
  const pending = db.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all() as Outbox[];
  for (const item of pending) {
    const response = await request(token, "/push", { method: "POST", body: JSON.stringify({
      mutationId: item.id, kind: item.entity_type, recordId: item.entity_id,
      projectId, baseRevision: revision(db, item.entity_type, item.entity_id), payload: JSON.parse(item.payload_json),
    }) });
    const result = await response.json() as { revision?: string; remote?: { revision: string; payload: object }; error?: string };
    if (response.status === 409) {
      if (!result.remote) throw new Error("Sync conflict has no remote record; local change was kept.");
      atomic(db, () => {
        db.prepare("INSERT INTO sync_conflicts VALUES (?, ?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET remote_payload_json = excluded.remote_payload_json, remote_revision = excluded.remote_revision")
          .run(item.entity_type, item.entity_id, JSON.stringify(result.remote!.payload), result.remote!.revision);
      });
      conflicts++;
      break;
    }
    if (!response.ok || !result.revision) throw new Error(result.error || `Sync push failed (${response.status}).`);
    atomic(db, () => {
      db.prepare("DELETE FROM sync_outbox WHERE id = ?").run(item.id);
      setRevision(db, item.entity_type, item.entity_id, result.revision!);
    });
    pushed++;
  }

  let cursor = (db.prepare("SELECT value FROM sync_state WHERE key = 'global_cursor'").get() as { value: string } | undefined)?.value || "0";
  while (true) {
    const response = await request(token, `/pull?cursor=${cursor}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`);
    const result = await response.json() as { events?: Event[]; cursor?: string; error?: string };
    if (!response.ok || !result.events || !result.cursor) throw new Error(result.error || `Sync pull failed (${response.status}).`);
    for (const event of result.events) {
      atomic(db, () => {
        if (BigInt(event.revision) > BigInt(revision(db, event.kind, event.recordId))) {
          const unsent = db.prepare("SELECT 1 FROM sync_outbox WHERE entity_type = ? AND entity_id = ? LIMIT 1").get(event.kind, event.recordId);
          if (unsent) {
            db.prepare("INSERT INTO sync_conflicts VALUES (?, ?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET remote_payload_json = excluded.remote_payload_json, remote_revision = excluded.remote_revision")
              .run(event.kind, event.recordId, JSON.stringify(event.payload), event.revision);
            conflicts++;
          } else {
            applyRecord(db, event);
            setRevision(db, event.kind, event.recordId, event.revision);
            pulled++;
          }
        }
        db.prepare("INSERT INTO sync_state VALUES ('global_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(event.revision);
      });
    }
    cursor = result.cursor;
    if (result.events.length < 100) break;
  }
  return { pushed, pulled, conflicts };
}

export function listConflicts(db: DatabaseSync) {
  return db.prepare("SELECT * FROM sync_conflicts ORDER BY entity_type, entity_id").all() as {
    entity_type: Kind; entity_id: string; remote_payload_json: string; remote_revision: string;
  }[];
}

export function resolveConflict(db: DatabaseSync, kind: Kind, id: string, choice: "local" | "remote") {
  const conflict = db.prepare("SELECT * FROM sync_conflicts WHERE entity_type = ? AND entity_id = ?")
    .get(kind, id) as { remote_payload_json: string; remote_revision: string } | undefined;
  if (!conflict) throw new Error("Conflict not found.");
  atomic(db, () => {
    db.prepare("DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ?").run(kind, id);
    if (choice === "remote") applyRecord(db, { kind, recordId: id, revision: conflict.remote_revision, payload: JSON.parse(conflict.remote_payload_json) });
    else {
      const record = localRecord(db, kind, id);
      if (!record) throw new Error("Local record not found.");
      queueUpsert(db, kind, record as { id: string });
    }
    setRevision(db, kind, id, conflict.remote_revision);
    db.prepare("DELETE FROM sync_conflicts WHERE entity_type = ? AND entity_id = ?").run(kind, id);
  });
}
