import type { FastifyInstance } from "fastify";
import { listRecentSessions } from "./repository.js";

export function registerHistoryRoutes(app: FastifyInstance): void {
  app.get("/api/history", async () => listRecentSessions());
}
