import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyHttpProxy from "@fastify/http-proxy";
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

// Read-only status/history endpoints also accept a shared service key
// (header X-Service-Key, env MOBILE_SERVICE_KEY) so the internal mobile
// app's backend (cedar-grove-api) can poll them server-to-server without
// a full browser Google OAuth session. This is additive: it never
// replaces the cookie check below, and it's only consulted for this
// fixed set of read-only paths — mutation endpoints still require a
// browser session.
const SERVICE_KEY_PATHS = new Set(["/api/input/status", "/api/relay/status", "/api/history"]);

function hasValidServiceKey(header: string | string[] | undefined): boolean {
  const expected = process.env.MOBILE_SERVICE_KEY;
  if (!expected) return false;
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Every /api/* and /hls/* route requires a valid session cookie except
// login/logout/me (needed to render the login screen itself), health
// (used for container healthchecks, not sensitive), and the read-only
// paths above when a valid X-Service-Key is present. Static assets stay
// public so the SPA shell can load and show the login form — data lives
// behind the API, not the JS.
app.addHook("onRequest", async (req, reply) => {
  const url = req.raw.url ?? "";
  if (!url.startsWith("/api/") && !url.startsWith("/hls/")) return;
  if (url.startsWith("/api/auth/") || url === "/api/health") return;

  const pathOnly = url.split("?")[0];
  if (SERVICE_KEY_PATHS.has(pathOnly) && hasValidServiceKey(req.headers["x-service-key"])) {
    return;
  }

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

// Proxies MediaMTX's HLS output so the browser only ever talks to this
// same origin — direct browser access to <host>:8888 breaks whenever the
// app is reached through something that only tunnels one port (Cloudflare
// Tunnel, a reverse proxy, etc.) or over HTTPS (mixed-content blocked).
app.register(fastifyHttpProxy, {
  upstream: "http://mediamtx:8888",
  prefix: "/hls",
  rewritePrefix: "",
});

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


const scheduler = new Scheduler(relayManager);
scheduler.start();

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
