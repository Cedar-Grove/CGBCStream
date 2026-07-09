import type { FastifyInstance } from "fastify";
import type { RelayManager } from "./relayManager.js";

export function registerRelayRoutes(app: FastifyInstance, relayManager: RelayManager): void {
  app.get("/api/relay/status", async () => relayManager.getAllStatus());
}
