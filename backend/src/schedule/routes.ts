import type { FastifyInstance } from "fastify";
import { createSchedule, deleteSchedule, listSchedules, updateSchedule } from "./repository.js";
import type { ScheduleInput } from "./types.js";

export function registerScheduleRoutes(app: FastifyInstance): void {
  app.get("/api/schedules", async () => listSchedules());

  app.post("/api/schedules", async (req, reply) => {
    const body = req.body as Partial<ScheduleInput> | undefined;
    if (!body?.title || !body.time || !body.durationMinutes || !body.recurrenceType) {
      return reply
        .code(400)
        .send({ error: "title, recurrenceType, time, durationMinutes are required" });
    }
    if (body.recurrenceType === "weekly" && body.dayOfWeek == null) {
      return reply.code(400).send({ error: "dayOfWeek is required for weekly schedules" });
    }
    if (body.recurrenceType === "once" && !body.date) {
      return reply.code(400).send({ error: "date is required for one-off schedules" });
    }
    const created = createSchedule({
      title: body.title,
      recurrenceType: body.recurrenceType,
      dayOfWeek: body.dayOfWeek,
      date: body.date,
      time: body.time,
      durationMinutes: body.durationMinutes,
      autoCreateYoutube: body.autoCreateYoutube ?? true,
      destinationIds: body.destinationIds ?? [],
      active: body.active ?? true,
    });
    return reply.code(201).send(created);
  });

  app.put("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = updateSchedule(id, req.body as Partial<ScheduleInput>);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.delete("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteSchedule(id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
}
