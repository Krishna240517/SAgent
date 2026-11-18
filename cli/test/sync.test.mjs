import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { migrate } from "../dist/storage/migrations.js";
import { addMessage, createConversation, getConversation, recentMessages, renameConversation } from "../dist/chat/store.js";
import { listConflicts, resolveConflict, syncNow } from "../dist/sync/client.js";

test("sync retries safely and requires an explicit conflict choice", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, "global");
  const conversation = createConversation(db);
  const originalFetch = globalThis.fetch;
  let remoteRevision = 0;
  let remotePayload;
  const events = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/api/auth/get-session")) return Response.json({ user: { id: "user-one" } });
    if (String(url).includes("/push")) {
      const body = JSON.parse(options.body);
      if (Number(body.baseRevision) !== remoteRevision) return Response.json({ error: "conflict", remote: { revision: String(remoteRevision), payload: remotePayload } }, { status: 409 });
      remoteRevision++;
      remotePayload = body.payload;
      events.push({ revision: String(remoteRevision), kind: body.kind, recordId: body.recordId, payload: body.payload });
      return Response.json({ revision: String(remoteRevision) });
    }
    const cursor = Number(new URL(url).searchParams.get("cursor"));
    return Response.json({ events: events.filter((event) => Number(event.revision) > cursor), cursor: String(remoteRevision) });
  };
  try {
    assert.deepEqual(await syncNow(db, "token"), { pushed: 1, pulled: 0, conflicts: 0 });
    renameConversation(db, conversation.id, "Local title");
    remoteRevision++;
    remotePayload = { ...remotePayload, title: "Remote title" };
    events.push({ revision: String(remoteRevision), kind: "conversation", recordId: conversation.id, payload: remotePayload });
    const conflict = await syncNow(db, "token");
    assert.ok(conflict.conflicts >= 1);
    assert.equal(getConversation(db, conversation.id).title, "Local title");
    assert.equal(listConflicts(db).length, 1);
    resolveConflict(db, "conversation", conversation.id, "remote");
    assert.equal(getConversation(db, conversation.id).title, "Remote title");
    assert.equal(db.prepare("SELECT count(*) AS n FROM sync_outbox").get().n, 0);

    renameConversation(db, conversation.id, "Keep local");
    remoteRevision++;
    remotePayload = { ...remotePayload, title: "Another remote title" };
    events.push({ revision: String(remoteRevision), kind: "conversation", recordId: conversation.id, payload: remotePayload });
    await syncNow(db, "token");
    resolveConflict(db, "conversation", conversation.id, "local");
    assert.equal(listConflicts(db).length, 0);
    const resolved = await syncNow(db, "token");
    assert.equal(resolved.pushed, 1);
    assert.equal(remotePayload.title, "Keep local");
    globalThis.fetch = async (url) => String(url).includes("/api/auth/get-session")
      ? Response.json({ user: { id: "user-two" } })
      : Response.json({ error: "should not send data" }, { status: 500 });
    await assert.rejects(syncNow(db, "token"), /another account/);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("project-scoped history follows a shared project ID", async () => {
  const a = new DatabaseSync(":memory:");
  const b = new DatabaseSync(":memory:");
  migrate(a, "project");
  migrate(b, "project");
  const projectId = randomUUID();
  const previousFetch = globalThis.fetch;
  const events = [];
  const records = new Map();
  let sequence = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/api/auth/get-session")) return Response.json({ user: { id: "same-user" } });
    if (String(url).includes("/push")) {
      const body = JSON.parse(options.body);
      assert.equal(body.projectId, projectId);
      const key = `${body.kind}:${body.recordId}`;
      const previous = records.get(key);
      assert.equal(body.baseRevision, previous?.revision || "0");
      const event = { revision: String(++sequence), kind: body.kind, recordId: body.recordId, payload: body.payload };
      records.set(key, event);
      events.push(event);
      return Response.json({ revision: event.revision });
    }
    const query = new URL(url).searchParams;
    assert.equal(query.get("projectId"), projectId);
    return Response.json({ events: events.filter((event) => Number(event.revision) > Number(query.get("cursor"))), cursor: String(sequence) });
  };
  try {
    const conversation = createConversation(a);
    addMessage(a, conversation.id, "user", "Project-specific discussion");
    await syncNow(a, "token", projectId);
    await syncNow(b, "token", projectId);
    assert.equal(getConversation(b, conversation.id).id, conversation.id);
    assert.equal(recentMessages(b, conversation.id)[0].content, "Project-specific discussion");
  } finally {
    globalThis.fetch = previousFetch;
    a.close();
    b.close();
  }
});

test("offline messages reach a second device and return to the first", async () => {
  const first = new DatabaseSync(":memory:");
  const second = new DatabaseSync(":memory:");
  migrate(first, "global");
  migrate(second, "global");
  const originalFetch = globalThis.fetch;
  let online = false;
  let sequence = 0;
  const records = new Map();
  const events = [];
  globalThis.fetch = async (url, options) => {
    if (!online) throw new Error("offline");
    if (String(url).includes("/api/auth/get-session")) return Response.json({ user: { id: "same-user" } });
    if (String(url).includes("/push")) {
      const body = JSON.parse(options.body);
      const key = `${body.kind}:${body.recordId}`;
      const old = records.get(key);
      if (body.baseRevision !== (old?.revision || "0")) return Response.json({ error: "conflict", remote: old }, { status: 409 });
      const record = { revision: String(++sequence), kind: body.kind, recordId: body.recordId, payload: body.payload };
      records.set(key, record);
      events.push(record);
      return Response.json({ revision: record.revision });
    }
    const cursor = Number(new URL(url).searchParams.get("cursor"));
    return Response.json({ events: events.filter((event) => Number(event.revision) > cursor), cursor: String(sequence) });
  };
  try {
    const conversation = createConversation(first);
    addMessage(first, conversation.id, "user", "Written offline");
    await assert.rejects(syncNow(first, "token"), /offline/);
    assert.ok(first.prepare("SELECT count(*) AS n FROM sync_outbox").get().n > 0);
    online = true;
    await syncNow(first, "token");
    await syncNow(second, "token");
    assert.equal(getConversation(second, conversation.id).title, "Written offline");
    assert.equal(recentMessages(second, conversation.id)[0].content, "Written offline");
    addMessage(second, conversation.id, "assistant", "Continued on device two");
    await syncNow(second, "token");
    await syncNow(first, "token");
    assert.equal(recentMessages(first, conversation.id)[1].content, "Continued on device two");
  } finally {
    globalThis.fetch = originalFetch;
    first.close();
    second.close();
  }
});
