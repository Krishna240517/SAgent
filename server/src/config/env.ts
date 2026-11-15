import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const dir = typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(dir, "../../.env") });



export const env = {
    BACKEND_PORT: process.env.PORT!,
    DATABASE_URL: process.env.DB_URL!,
    FRONTEND_PORT: process.env.FRT_PORT!,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
}
console.log(process.env.PORT);
