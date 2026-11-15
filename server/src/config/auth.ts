import { betterAuth } from "better-auth";
import { prisma } from "./db";
import { env } from "./env";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";

export const auth = betterAuth({
    database: prismaAdapter(prisma,{
        provider:"postgresql"
    }),

    trustedOrigins: [`http://localhost:${env.FRONTEND_PORT}`],
    baseURL: `http://localhost:${env.BACKEND_PORT}`,
    basePath: "/api/auth",
    socialProviders: {
        github:{
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET
        }
    },

    plugins:[bearer()],

    logger: {
        level: "debug"
    }
})