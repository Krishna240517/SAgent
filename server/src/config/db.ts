import { PrismaClient } from "../generated/prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "./env";

let authPrismaInstance: PrismaClient | null = null;
let authPglite: PGlite | null = null;

export const authPrisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!authPrismaInstance) throw new Error(`authPrisma accessed before connectAuthDB(): ${String(prop)}`);
    const value = (authPrismaInstance as any)[prop];
    return typeof value === "function" ? value.bind(authPrismaInstance) : value;
  },
});

export async function connectAuthDB() {
  if (authPrismaInstance) return authPrismaInstance;
  if (process.env.NODE_ENV === "production" && !env.AUTH_DATABASE_URL) {
    throw new Error("AUTH_DATABASE_URL is required in production");
  }

  try {
    if (env.AUTH_DATABASE_URL) {
      authPrismaInstance = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.AUTH_DATABASE_URL }) });
    } else {
      const directory = path.join(os.homedir(), ".sagent", "auth", "data");
      fs.mkdirSync(directory, { recursive: true });
      authPglite = new PGlite(directory);
      const existing = await authPglite.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('user', 'session', 'account', 'verification')",
      );
      if (existing.rows.length === 0) {
        await authPglite.exec(fs.readFileSync(new URL("../../prisma/auth.sql", import.meta.url), "utf8"));
      } else if (existing.rows.length !== 4) {
        throw new Error("Local auth database has an incomplete schema");
      }
      await authPglite.exec(fs.readFileSync(new URL("../../prisma/device.sql", import.meta.url), "utf8"));
      const syncTables = await authPglite.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('SyncProject', 'SyncRecord', 'SyncEvent', 'SyncMutation')",
      );
      if (syncTables.rows.length === 0) {
        await authPglite.exec(fs.readFileSync(new URL("../../prisma/migrations/202611170002_sync/migration.sql", import.meta.url), "utf8"));
      } else if (syncTables.rows.length !== 4) {
        throw new Error("Local sync database has an incomplete schema");
      }
      authPrismaInstance = new PrismaClient({ adapter: new PrismaPGlite(authPglite) });
    }
    await authPrismaInstance.$connect();
    await authPrismaInstance.deviceCode.count();
    return authPrismaInstance;
  } catch (error) {
    await authPrismaInstance?.$disconnect();
    await authPglite?.close();
    authPrismaInstance = null;
    authPglite = null;
    throw error;
  }
}

export async function disconnectAuthDB() {
  await authPrismaInstance?.$disconnect();
  await authPglite?.close();
  authPrismaInstance = null;
  authPglite = null;
}
