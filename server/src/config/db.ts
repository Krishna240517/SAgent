import { PrismaClient } from "../generated/prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import os from "os";
import path from "path";
import fs from "fs";

let prismaInstance: PrismaClient | null = null;
let currentPglite: PGlite | null = null;

// Export a Proxy so imports always hold a valid object reference
export const prisma = new Proxy({} as PrismaClient, {
    get(_target, prop) {
        if (!prismaInstance) {
            throw new Error(
                `Prisma accessed before connectDB() was called (tried to access "${String(prop)}")`
            );
        }
        const value = (prismaInstance as any)[prop];
        return typeof value === "function" ? value.bind(prismaInstance) : value;
    },
});

function sanitizeProjectPath(projectPath: string): string {
    const resolvedPath = fs.existsSync(projectPath)
        ? fs.realpathSync(projectPath)
        : path.resolve(projectPath);

    return resolvedPath.replace(/[:\\/]+/g, "-");
}

export default async function connectDB(projectPath?: string) {
    try {
        if (prismaInstance) {
            await prismaInstance.$disconnect();
        }
        if (currentPglite) {
            await currentPglite.close();
        }

        const activeProject = projectPath || process.cwd();
        const projectKey = sanitizeProjectPath(activeProject);

        const dbDirectory = path.join(
            os.homedir(),
            ".sagent",
            "projects",
            projectKey,
            "data"
        );

        if (!fs.existsSync(dbDirectory)) {
            fs.mkdirSync(dbDirectory, { recursive: true });
        }

        currentPglite = new PGlite(dbDirectory);
        const adapter = new PrismaPGlite(currentPglite);

        prismaInstance = new PrismaClient({ adapter });

        console.log(`Connected to DB for project [${projectKey}] at:`, dbDirectory);
        await prismaInstance.$connect();

        return prismaInstance;
    } catch (e) {
        console.error("Error in connecting to Database:", e);
        process.exit(1);
    }
}
