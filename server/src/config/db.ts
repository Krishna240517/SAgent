import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "./env";

const pool = new pg.Pool({
    connectionString: env.DATABASE_URL
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export default async function connectDB() {
    try {
        await prisma.$connect();
        console.log("Successfully connected to DB");
    }
    catch (e) {
        console.log("Error in connecting to Database");
        process.exit(1);
    }
}