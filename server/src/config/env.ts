import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const dir = typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(dir, "../../.env") });



export const env = {
    BACKEND_PORT: process.env.PORT!,
    AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
    BASE_URL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || "6005"}`,
    FRONTEND_URL: process.env.FRONTEND_URL || `http://localhost:${process.env.FRT_PORT || "3000"}`,
    DEVICE_CLIENT_ID: process.env.SAGENT_CLIENT_ID || "sagent-cli",
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
}
