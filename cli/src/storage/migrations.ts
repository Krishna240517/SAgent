import type { DatabaseSync } from "node:sqlite";

const sharedTables = `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sync_outbox_created_idx ON sync_outbox(created_at);
`;

const migrations = {
  global: [sharedTables + `
CREATE TABLE project_links (
  project_id TEXT PRIMARY KEY,
  local_path TEXT NOT NULL UNIQUE,
  remote_url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`, `
CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source_message_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE accepted_preferences (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  source_message_id TEXT,
  approved_at TEXT NOT NULL
);
CREATE TABLE sync_revisions (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sync_conflicts (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  remote_payload_json TEXT NOT NULL,
  remote_revision TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
`],
  project: [sharedTables + `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`],
} as const;

export function migrate(db: DatabaseSync, kind: keyof typeof migrations): void {
  // BEGIN IMMEDIATE serializes startup migrations across CLI processes.
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    const scripts = migrations[kind];
    if (current > scripts.length) throw new Error(`${kind} database is newer than this SAgent CLI`);
    for (let version = current; version < scripts.length; version++) {
      db.exec(scripts[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
