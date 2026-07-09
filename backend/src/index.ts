import Fastify from "fastify";
import { FfmpegRelay } from "./relay/ffmpegRelay.js";

const PORT = Number(process.env.PORT ?? 3000);
const SOURCE_RTMP_URL = process.env.SOURCE_RTMP_URL ?? "rtmp://mediamtx:1935/live";
const DEST_RTMP_URL = process.env.DEST_RTMP_URL;
const AUTO_START = process.env.AUTO_START === "true";

if (!DEST_RTMP_URL) {
  throw new Error("DEST_RTMP_URL must be set (phase 1: single hardcoded destination)");
}

const relay = new FfmpegRelay(SOURCE_RTMP_URL, DEST_RTMP_URL);

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

app.get("/relay/status", async () => relay.getStatus());

app.post("/relay/start", async () => {
  relay.start();
  return relay.getStatus();
});

app.post("/relay/stop", async () => {
  relay.stop();
  return relay.getStatus();
});

if (AUTO_START) {
  relay.start();
}

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
