import type { FastifyInstance } from "fastify";
import {
  createDestination,
  deleteDestination,
  getFullRtmpUrl,
  listDestinations,
  setEnabled,
  updateDestination,
} from "./repository.js";
import { PLATFORMS, type DestinationInput } from "./types.js";
import type { RelayManager } from "../relay/relayManager.js";

function isValidPlatform(value: unknown): value is DestinationInput["platform"] {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function registerDestinationRoutes(app: FastifyInstance, relayManager: RelayManager): void {
  app.get("/api/destinations", async () => listDestinations());

  app.post("/api/destinations", async (req, reply) => {
    const body = req.body as Partial<DestinationInput> | undefined;
    if (!body?.name || !body?.serverUrl || !body?.streamKey) {
      return reply.code(400).send({ error: "name, platform, serverUrl, streamKey are required" });
    }
    if (!isValidPlatform(body.platform)) {
      return reply.code(400).send({ error: `platform must be one of ${PLATFORMS.join(", ")}` });
    }
    const created = createDestination(body as DestinationInput);
    return reply.code(201).send(created);
  });

  app.put("/api/destinations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<DestinationInput>;
    if (body.platform !== undefined && !isValidPlatform(body.platform)) {
      return reply.code(400).send({ error: `platform must be one of ${PLATFORMS.join(", ")}` });
    }
    const updated = updateDestination(id, body);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.delete("/api/destinations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    relayManager.stop(id);
    const ok = deleteDestination(id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });

  app.post("/api/destinations/:id/enable", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rtmpUrl = getFullRtmpUrl(id);
    if (!rtmpUrl) return reply.code(404).send({ error: "not found" });
    setEnabled(id, true);
    relayManager.start(id, rtmpUrl);
    return { ok: true };
  });

  app.post("/api/destinations/:id/disable", async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = setEnabled(id, false);
    if (!updated) return reply.code(404).send({ error: "not found" });
    relayManager.stop(id);
    return { ok: true };
  });
}
