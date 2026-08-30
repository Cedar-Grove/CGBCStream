import type { FastifyInstance } from "fastify";
import type { RelayManager } from "../relay/relayManager.js";
import { stopDestination } from "./service.js";
import {
  createDestination,
  deleteDestination,
  getYoutubeAccountId,
  listDestinations,
  setEnabled,
  updateDestination,
} from "./repository.js";
import { deleteAccount } from "../youtube/accountsRepository.js";
import { PLATFORMS, type DestinationInput } from "./types.js";

function isValidPlatform(value: unknown): value is DestinationInput["platform"] {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function registerDestinationRoutes(app: FastifyInstance, relayManager: RelayManager): void {
  app.get("/api/destinations", async () => listDestinations());

  app.post("/api/destinations", async (req, reply) => {
    const body = req.body as Partial<DestinationInput> | undefined;
    if (!isValidPlatform(body?.platform)) {
      return reply.code(400).send({ error: `platform must be one of ${PLATFORMS.join(", ")}` });
    }
    if (body?.platform === "youtube") {
      return reply
        .code(400)
        .send({ error: "Connect a YouTube channel via /api/youtube/auth instead of adding it manually" });
    }
    if (!body?.name || !body?.serverUrl || !body?.streamKey) {
      return reply.code(400).send({ error: "name, platform, serverUrl, streamKey are required" });
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
    await stopDestination(relayManager, id);
    // Removing a YouTube destination disconnects the channel with it —
    // otherwise its stored refresh token lingers with nothing referencing it.
    const accountId = getYoutubeAccountId(id);
    const ok = deleteDestination(id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    if (accountId) deleteAccount(accountId);
    return reply.code(204).send();
  });

  // `enabled` marks a destination for use by scheduled streams. Toggling it
  // never starts or stops a relay -- only the scheduler does that, at the
  // occurrence's start and end.
  app.post("/api/destinations/:id/enable", async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = setEnabled(id, true);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.post("/api/destinations/:id/disable", async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = setEnabled(id, false);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });
}
