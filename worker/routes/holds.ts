import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const schema = z.object({ orderId: z.string().min(1), orderLineId: z.string().min(1), size: z.string().min(1), pairs: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }).strict();
export function registerHoldRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.post("/api/admin/holds", async (context) => {
    const input = await parseBody(context, schema);
    await repository.applyHold(context.get("session"), input, context.get("correlationId"));
    return context.json({ status: "ACTIVE" }, 201);
  });
}
