import { Command } from "commander";
import { getStoredToken } from "../commands/auth/token.js";
import { openGlobalStore } from "../storage/index.js";
import { listConflicts, localRecord, resolveConflict, syncNow } from "./client.js";

export const sync = new Command("sync").description("Sync conversations and approved memories").action(async () => {
  const token = await getStoredToken();
  if (!token) throw new Error("Run sagent login before syncing.");
  const db = openGlobalStore();
  try {
    const result = await syncNow(db, token.access_token);
    console.log(`Pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}.`);
    if (result.conflicts) console.log("Run sagent sync conflicts to review them.");
  } finally { db.close(); }
});

sync.command("conflicts").description("Review local and remote versions").action(() => {
  const db = openGlobalStore();
  try {
    for (const item of listConflicts(db)) {
      console.log(`${item.entity_type} ${item.entity_id}`);
      console.log(`  local: ${JSON.stringify(localRecord(db, item.entity_type, item.entity_id))}`);
      console.log(`  remote: ${item.remote_payload_json}`);
    }
  } finally { db.close(); }
});

sync.command("resolve <kind> <id> <choice>").description("Choose local or remote for a conflict").action((kind: string, id: string, choice: string) => {
  if (!["conversation", "message", "decision", "preference"].includes(kind) || !["local", "remote"].includes(choice)) {
    throw new Error("Use a valid kind and choose local or remote.");
  }
  const db = openGlobalStore();
  try { resolveConflict(db, kind as "conversation" | "message" | "decision" | "preference", id, choice as "local" | "remote"); }
  finally { db.close(); }
  console.log("Conflict resolved locally. Run sagent sync to send or pull changes.");
});
