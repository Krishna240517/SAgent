import express from "express";
import { env } from "./config/env";
import { connectAuthDB } from "./config/db";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import { auth } from "./config/auth";
import { streamChat } from "./chat";
import { syncRouter } from "./sync";

const port = env.BACKEND_PORT;
const app = express();

app.use(cors({
    origin: [env.FRONTEND_URL],
    credentials: true
}))


app.get("/health",(req, res) => {
    res.send("OK!!");
})


async function main() {
    await connectAuthDB();
    app.all("/api/auth/*splat", toNodeHandler(auth.handler));
    app.use(express.json({ limit: "128kb" }));
    app.post("/api/chat/stream", streamChat);
    app.use("/api/sync", syncRouter);
    app.listen(port,() => {
        console.log(`Backend Server running on PORT ${port}`)
    })
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
})
