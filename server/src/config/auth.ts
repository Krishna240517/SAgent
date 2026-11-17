import { betterAuth } from "better-auth";
import { authPrisma } from "./db";
import { env } from "./env";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, deviceAuthorization } from "better-auth/plugins";

function createAuth() {
    return betterAuth({
        database: prismaAdapter(authPrisma, {
            provider: "postgresql",
        }),

        trustedOrigins: [env.FRONTEND_URL],
        baseURL: env.BASE_URL,
        basePath: "/api/auth",
        socialProviders: {
            github: {
                clientId: env.GITHUB_CLIENT_ID,
                clientSecret: env.GITHUB_CLIENT_SECRET,
            },
        },

        plugins: [bearer(), deviceAuthorization({
            verificationUri: `${env.FRONTEND_URL}/device`,
            validateClient: (clientId) => clientId === env.DEVICE_CLIENT_ID,
        })],

        logger: {
            level: "debug",
        },
    });
}

type AuthInstance = ReturnType<typeof createAuth>;
let authInstance: AuthInstance | null = null;

// Lazy Proxy ensures betterAuth() runs only after connectAuthDB() has initialized authPrisma
export const auth = new Proxy({} as AuthInstance, {
    get(_target, prop) {
        if (!authInstance) {
            authInstance = createAuth();
        }
        const value = (authInstance as any)[prop];
        return typeof value === "function" ? value.bind(authInstance) : value;
    },
});
