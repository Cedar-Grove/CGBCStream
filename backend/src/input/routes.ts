import type { FastifyInstance } from "fastify";
import { getInputStatus } from "./inputMonitor.js";

export function registerInputRoutes(app: FastifyInstance): void {
  app.get("/api/input/status", async () => getInputStatus());
}
