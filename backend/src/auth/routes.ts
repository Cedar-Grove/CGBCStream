import type { FastifyInstance } from "fastify";
import { getLoginUrl, handleLoginCallback, isDomainAllowed } from "./googleAuth.js";
import { COOKIE_NAME, createSession, destroySession, getSession } from "./session.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/auth/login", async (_req, reply) => {
    try {
      return reply.redirect(getLoginUrl());
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get("/api/auth/google/callback", async (req, reply) => {
    const { code } = req.query as { code?: string };
    if (!code) return reply.code(400).send({ error: "missing code" });

    try {
      const identity = await handleLoginCallback(code);
      if (!isDomainAllowed(identity)) {
        app.log.warn(`rejected sign-in from ${identity.email} — domain not allowed`);
        return reply.redirect("/?authError=domain");
      }
      const token = createSession(identity.email);
      reply.setCookie(COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
      return reply.redirect("/");
    } catch (err) {
      app.log.error(err);
      return reply.redirect("/?authError=failed");
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    destroySession(req.cookies[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    const session = getSession(req.cookies[COOKIE_NAME]);
    return { authenticated: !!session, email: session?.email ?? null };
  });
}
