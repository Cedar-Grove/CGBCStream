import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { registerAuthRoutes } from "./auth/routes.js";
import { COOKIE_NAME, isValidSession } from "./auth/session.js";
import { registerDestinationRoutes } from "./destinations/routes.js";
import { registerHistoryRoutes } from "./history/routes.js";
import { registerInputRoutes } from "./input/routes.js";
import { RelayManager } from "./relay/relayManager.js";
import { registerRelayRoutes } from "./relay/routes.js";
import { registerScheduleRoutes } from "./schedule/routes.js";
import { Scheduler } from "./schedule/scheduler.js";
import { registerYoutubeRoutes } from "./youtube/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const SOURCE_RTMP_URL = process.env.SOURCE_RTMP_URL ?? "rtmp://mediamtx:1935/live";

const relayManager = new RelayManager(SOURCE_RTMP_URL);

const app = Fastify({ logger: true });

app.register(fastifyCookie);

// Every /api/* route requires a valid session cookie except login/logout/me
// (needed to render the login screen itself) and health (used for container
// healthchecks, not sensitive). Static assets stay public so the SPA shell
// can load and show the login form — data lives behind the API, not the JS.
app.addHook("onRequest", async (req, reply) => {
  const url = req.raw.url ?? "";
  if (!url.startsWith("/api/")) return;
  if (url.startsWith("/api/auth/") || url === "/api/health") return;
  if (!isValidSession(req.cookies[COOKIE_NAME])) {
    return reply.code(401).send({ error: "authentication required" });
  }
});

app.get("/api/health", async () => ({ ok: true }));

registerAuthRoutes(app);
registerDestinationRoutes(app, relayManager);
registerRelayRoutes(app, relayManager);
registerInputRoutes(app);
registerYoutubeRoutes(app);
registerScheduleRoutes(app);
registerHistoryRoutes(app);

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

const scheduler = new Scheduler(relayManager);
scheduler.start();

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
