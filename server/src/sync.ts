import { Router } from "express";
import { z } from "zod";
import { auth } from "./config/auth";
import { authPrisma } from "./config/db";

const id = z.string().uuid();
const time = z.string().datetime();
const revisionText = z.string().regex(/^\d{1,20}$/).refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
const payloads = {
  task: z.object({ id, title: z.string().min(1).max(2000), status: z.enum(["running","completed","failed","pending"]),
    created_at: time, updated_at: time, revision: z.string().regex(/^[a-f0-9]{40,64}$/).nullable(),
    workspace_hash: z.string().regex(/^[a-f0-9]{64}$/), private_required: z.union([z.literal(0),z.literal(1)]),
    summary: z.string().max(2000).nullable() }).strict(),
  conversation: z.object({ id, title: z.string().min(1).max(120), created_at: time, updated_at: time }),
  message: z.object({ id, conversation_id: id, role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000), created_at: time }),
  decision: z.object({ id, supersedes_id: id.nullable().optional(), content: z.string().min(1).max(10_000), source_message_id: id.nullable(), created_at: time }),
  preference: z.object({ id, content: z.string().min(1).max(500), source: z.enum(["user", "message"]), source_message_id: id.nullable(), approved_at: time }),
} as const;
type Kind = keyof typeof payloads;

const pushInput = z.object({
  mutationId: id,
  kind: z.enum(["conversation", "message", "decision", "preference","task"]),
  recordId: id,
  projectId: id.nullable().optional(),
  baseRevision: revisionText,
  payload: z.record(z.string(), z.unknown()),
});

export const syncRouter = Router();

syncRouter.use(async (req, res, next) => {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in first." });
  try {
    const session = await auth.api.getSession({ headers: new Headers({ authorization }) });
    if (!session) return res.status(401).json({ error: "Session expired." });
    res.locals.userId = session.user.id;
    next();
  } catch {
    res.status(503).json({ error: "Authentication is unavailable." });
  }
});

async function ownsProject(userId: string, projectId: string | null | undefined) {
  if (!projectId) return true;
  return Boolean(await authPrisma.syncProject.findFirst({ where: { id: projectId, userId } }));
}

syncRouter.get("/projects", async (_req, res) => {
  const projects = await authPrisma.syncProject.findMany({ where: { userId: res.locals.userId }, select: { id: true, remoteUrl: true, createdAt: true } });
  res.json({ projects });
});

syncRouter.post("/projects", async (req, res) => {
  const parsed = z.object({ id, remoteUrl: z.string().max(2048).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid project ID." });
  const remoteUrl = parsed.data.remoteUrl;
  if (remoteUrl && !isSafeRemote(remoteUrl)) return res.status(400).json({ error: "Invalid Git remote URL." });
  const userId: string = res.locals.userId;
  const existing = await authPrisma.syncProject.findUnique({ where: { id: parsed.data.id } });
  if (existing && existing.userId !== userId) return res.status(403).json({ error: "Project unavailable." });
  if (!existing) {
    try { await authPrisma.syncProject.create({ data: { id: parsed.data.id, userId, remoteUrl } }); }
    catch (error) {
      if ((error as { code?: string }).code === "P2002") return res.status(403).json({ error: "Project unavailable." });
      return res.status(500).json({ error: "Project registration failed." });
    }
  } else if (remoteUrl !== undefined && existing.remoteUrl !== remoteUrl) {
    await authPrisma.syncProject.update({ where: { id: existing.id }, data: { remoteUrl } });
  }
  res.json({ id: parsed.data.id });
});

function isSafeRemote(value: string) {
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

syncRouter.get("/pull", async (req, res) => {
  const parsed = z.object({ cursor: revisionText.default("0"), projectId: id.optional() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid cursor or project ID." });
  const userId: string = res.locals.userId;
  const projectId = parsed.data.projectId || null;
  if (!await ownsProject(userId, projectId)) return res.status(403).json({ error: "Project unavailable." });
  const events = await authPrisma.syncEvent.findMany({
    where: { userId, projectId, revision: { gt: BigInt(parsed.data.cursor) } },
    orderBy: { revision: "asc" }, take: 100,
  });
  res.json({ events: events.map(({ revision, kind, recordId, payload }) => ({ revision: revision.toString(), kind, recordId, payload })),
    cursor: events.at(-1)?.revision.toString() || parsed.data.cursor });
});

syncRouter.post("/push", async (req, res) => {
  const input = pushInput.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid sync mutation." });
  const { mutationId, kind, recordId, baseRevision } = input.data;
  const projectId = input.data.projectId || null;
  if (kind === "task" && !projectId) return res.status(400).json({ error: "Task requires project scope." });
  const payload = payloads[kind as Kind].safeParse(input.data.payload);
  if (!payload.success || payload.data.id !== recordId) return res.status(400).json({ error: "Invalid record." });
  const userId: string = res.locals.userId;
  if (!await ownsProject(userId, projectId)) return res.status(403).json({ error: "Project unavailable." });
  const mutationKey = { userId_mutationId: { userId, mutationId } };
  const replay = await authPrisma.syncMutation.findUnique({ where: mutationKey });
  if (replay) return res.json({ revision: replay.revision.toString() });
  if (kind === "message") {
    const parent = await authPrisma.syncRecord.findUnique({
      where: { userId_kind_recordId: { userId, kind: "conversation", recordId: (payload.data as { conversation_id: string }).conversation_id } },
    });
    if (!parent || parent.projectId !== projectId) return res.status(400).json({ error: "Conversation unavailable." });
  }

  try {
    const revision = await authPrisma.$transaction(async (tx) => {
      const key = { userId_kind_recordId: { userId, kind, recordId } };
      const current = await tx.syncRecord.findUnique({ where: key });
      if (current && current.projectId !== projectId) throw new Error("conflict");
      if ((current?.revision || 0n) !== BigInt(baseRevision)) throw new Error("conflict");
      const event = await tx.syncEvent.create({ data: { userId, kind, recordId, projectId, payload: payload.data } });
      if (current) {
        const changed = await tx.syncRecord.updateMany({
          where: { userId, kind, recordId, revision: current.revision },
          data: { payload: payload.data, revision: event.revision, updatedAt: new Date() },
        });
        if (changed.count !== 1) throw new Error("conflict");
      } else {
        await tx.syncRecord.create({ data: { userId, kind, recordId, projectId, payload: payload.data, revision: event.revision } });
      }
      await tx.syncMutation.create({ data: { userId, mutationId, revision: event.revision } });
      return event.revision;
    });
    res.json({ revision: revision.toString() });
  } catch (error) {
    const accepted = await authPrisma.syncMutation.findUnique({ where: mutationKey });
    if (accepted) return res.json({ revision: accepted.revision.toString() });
    if (!(error instanceof Error && error.message === "conflict") && (error as { code?: string }).code !== "P2002") {
      return res.status(500).json({ error: "Sync write failed." });
    }
    const current = await authPrisma.syncRecord.findUnique({ where: { userId_kind_recordId: { userId, kind, recordId } } });
    res.status(409).json({ error: "conflict", remote: current ? { revision: current.revision.toString(), payload: current.payload } : null });
  }
});
