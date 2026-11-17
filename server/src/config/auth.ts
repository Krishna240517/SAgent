import { betterAuth } from "better-auth";
import { prisma } from "./db";
import { env } from "./env";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";

function createAuth() {
    return betterAuth({
        database: prismaAdapter(prisma, {
            provider: "postgresql",
        }),

        trustedOrigins: [`http://localhost:${env.FRONTEND_PORT}`],
        baseURL: `http://localhost:${env.BACKEND_PORT}`,
        basePath: "/api/auth",
        socialProviders: {
            github: {
                clientId: env.GITHUB_CLIENT_ID,
                clientSecret: env.GITHUB_CLIENT_SECRET,
            },
        },

        plugins: [bearer()],

        logger: {
            level: "debug",
        },
    });
}

type AuthInstance = ReturnType<typeof createAuth>;
let authInstance: AuthInstance | null = null;

// Called by connectDB() when switching projects so auth re-initializes with the new DB
export function resetAuth() {
    authInstance = null;
}

// Lazy Proxy ensures betterAuth() runs only after connectDB() has initialized prisma
export const auth = new Proxy({} as AuthInstance, {
    get(_target, prop) {
        if (!authInstance) {
            authInstance = createAuth();
        }
        const value = (authInstance as any)[prop];
        return typeof value === "function" ? value.bind(authInstance) : value;
    },
});
