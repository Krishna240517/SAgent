import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { auth } from "./config/auth";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function streamChat(req: Request, res: Response) {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in first." });
  try {
    const session = await auth.api.getSession({ headers: new Headers({ authorization }) });
    if (!session) return res.status(401).json({ error: "Session expired." });
  } catch {
    return res.status(503).json({ error: "Authentication is unavailable." });
  }

  const messages: unknown = req.body?.messages;
  const preferences: unknown = req.body?.preferences || [];
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40 ||
      messages.some((item: unknown) => !item || typeof item !== "object" ||
        !["user", "assistant"].includes((item as ChatMessage).role) ||
        typeof (item as ChatMessage).content !== "string" ||
        (item as ChatMessage).content.length === 0 || (item as ChatMessage).content.length > 20_000) ||
      (messages as ChatMessage[]).at(-1)?.role !== "user" ||
      (messages as ChatMessage[]).reduce((size, item) => size + item.content.length, 0) > 100_000 ||
      !Array.isArray(preferences) || preferences.length > 20 ||
      preferences.some((item: unknown) => typeof item !== "string" || item.length > 500)) {
    return res.status(400).json({ error: "Invalid conversation messages." });
  }
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Model service is not configured." });

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const upstream = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna", input: messages,
        instructions: preferences.length ? `Respect these user-approved preferences when helpful:\n${preferences.join("\n")}` : undefined,
        stream: true, store: false,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: `Model service failed (${upstream.status}).` });
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    await pipeline(Readable.fromWeb(upstream.body as any), res);
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "Model service is unavailable." });
    else res.destroy();
  }
}
