import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { registerDestinationRoutes } from "./destinations/routes.js";
import { RelayManager } from "./relay/relayManager.js";
import { registerRelayRoutes } from "./relay/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const SOURCE_RTMP_URL = process.env.SOURCE_RTMP_URL ?? "rtmp://mediamtx:1935/live";

const relayManager = new RelayManager(SOURCE_RTMP_URL);

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ ok: true }));

registerDestinationRoutes(app, relayManager);
registerRelayRoutes(app, relayManager);

// The built frontend (backend/public, produced by the frontend build in
// Docker) is served from here; absent in plain backend-only dev mode.
const publicDir = path.join(__dirname, "..", "public");
if (existsSync(publicDir)) {
  app.register(fastifyStatic, { root: publicDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
}

relayManager.reconcile();

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
