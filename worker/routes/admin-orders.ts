import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const approveSchema = z.object({}).strict();
const revisionSchema = z.object({ lines: z.array(z.object({ offeringId: z.string().min(1), quantities: z.record(z.string(), z.number().int().nonnegative()) }).strict()).min(1) }).strict();

export function registerAdminOrderRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.post("/api/admin/orders/:orderId/approve", async (context) => {
    await parseBody(context, approveSchema);
    return context.json({ order: await repository.approveOrder(context.get("session"), context.req.param("orderId"), context.get("correlationId")) });
  });
  app.post("/api/admin/orders/:orderId/revisions", async (context) => {
    const input = await parseBody(context, revisionSchema);
    const order = await repository.reviseOrder(context.get("session"), context.req.param("orderId"), input.lines, context.get("correlationId"));
    return context.json({ order }, 201);
  });
}
