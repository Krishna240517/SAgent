import { test, expect } from "bun:test";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "../src/generated/prisma/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("device approval issues a revocable bearer session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-device-"));
  const pglite = new PGlite(path.join(root, "data"));
  let prisma: PrismaClient | undefined;
  try {
    await pglite.exec(fs.readFileSync(new URL("../prisma/auth.sql", import.meta.url), "utf8"));
    await pglite.exec(fs.readFileSync(new URL("../prisma/device.sql", import.meta.url), "utf8"));
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
    await prisma.$connect();
    const auth = betterAuth({
      database: prismaAdapter(prisma, { provider: "postgresql" }),
      baseURL: "http://localhost:6005",
      secret: "test-secret-that-is-long-enough-for-auth",
      emailAndPassword: { enabled: true },
      plugins: [bearer(), deviceAuthorization({ validateClient: (id) => id === "sagent-cli" })],
    });
    const call = async (route: string, body?: object, cookie?: string, token?: string) => auth.handler(new Request(`http://localhost:6005/api/auth${route}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }));
    const signup = await call("/sign-up/email", { name: "Test", email: "phase2@example.test", password: "passphrase-123" });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const issue = await call("/device/code", { client_id: "sagent-cli" });
    expect(issue.status).toBe(200);
    const { device_code, user_code } = await issue.json() as { device_code: string; user_code: string };
    const verify = await call(`/device?user_code=${user_code}`, undefined, cookie);
    expect(verify.status).toBe(200);
    const approve = await call("/device/approve", { userCode: user_code }, cookie);
    expect(approve.status).toBe(200);
    const redeem = await call("/device/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code, client_id: "sagent-cli" });
    expect(redeem.status).toBe(200);
    const { access_token } = await redeem.json() as { access_token: string };
    expect(access_token).toBeTruthy();
    expect((await call("/get-session", undefined, undefined, access_token)).status).toBe(200);
    expect((await call("/sign-out", {}, undefined, access_token)).status).toBe(200);
    const ended = await call("/get-session", undefined, undefined, access_token);
    expect(await ended.json()).toBeNull();
  } finally {
    await prisma?.$disconnect();
    await pglite.close();
    expect(path.dirname(root)).toBe(os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
