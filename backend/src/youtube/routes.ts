import type { FastifyInstance } from "fastify";
import { createDestination } from "../destinations/repository.js";
import { createAccount, listAccounts } from "./accountsRepository.js";
import { getAuthUrl, handleOAuthCallback } from "./youtubeService.js";

export function registerYoutubeRoutes(app: FastifyInstance): void {
  app.get("/api/youtube/accounts", async () => listAccounts());

  app.get("/api/youtube/auth", async (_req, reply) => {
    try {
      return reply.redirect(getAuthUrl());
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get("/api/youtube/oauth/callback", async (req, reply) => {
    const { code } = req.query as { code?: string };
    if (!code) return reply.code(400).send({ error: "missing code" });

    try {
      const { channelTitle, refreshToken } = await handleOAuthCallback(code);
      const account = createAccount(channelTitle, refreshToken);
      createDestination({
        name: channelTitle,
        platform: "youtube",
        youtubeAccountId: account.id,
      });
      return reply.redirect("/destinations?connected=youtube");
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
