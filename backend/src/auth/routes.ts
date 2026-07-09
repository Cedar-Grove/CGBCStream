import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { COOKIE_NAME, createSession, destroySession, isValidSession } from "./session.js";

function passwordMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first —
  // still safe since password length isn't the secret being protected.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/api/auth/login", async (req, reply) => {
    const { password } = (req.body as { password?: string } | undefined) ?? {};
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      return reply.code(500).send({ error: "ADMIN_PASSWORD is not configured on the server" });
    }
    if (!password || !passwordMatches(password, expected)) {
      return reply.code(401).send({ error: "incorrect password" });
    }
    const token = createSession();
    reply.setCookie(COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    destroySession(req.cookies[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({
    authenticated: isValidSession(req.cookies[COOKIE_NAME]),
  }));
}
