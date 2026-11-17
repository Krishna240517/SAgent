import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export function atomic<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function queueUpsert(db: DatabaseSync, kind: string, record: { id: string }): void {
  db.prepare("INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload_json, created_at) VALUES (?, ?, ?, 'upsert', ?, ?)")
    .run(randomUUID(), kind, record.id, JSON.stringify(record), new Date().toISOString());
}
