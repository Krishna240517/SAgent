import express from "express";
import { env } from "./config/env";
import connectDB from "./config/db";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import { auth } from "./config/auth";

const port = env.BACKEND_PORT;
const app = express();

app.use(cors({
    origin: [`http://localhost:${env.FRONTEND_PORT}`],
    credentials: true
}))
app.all("/api/auth/*splat", toNodeHandler(auth))
app.use(express.json());


app.get("/health",(req, res) => {
    res.send("OK!!");
})


async function main() {
    await connectDB();
    app.listen(port,() => {
        console.log(`Backend Server running on PORT ${port}`)
    })
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
})