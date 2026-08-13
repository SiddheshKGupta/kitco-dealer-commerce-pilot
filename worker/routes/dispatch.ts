import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const schema = z.object({ orderId: z.string().min(1), orderLineId: z.string().min(1), size: z.string().min(1), pairs: z.number().int().positive() }).strict();
export function registerDispatchRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.post("/api/admin/dispatches", async (context) => {
    const input = await parseBody(context, schema);
    await repository.createDispatch(context.get("session"), input, context.get("correlationId"));
    return context.json({ status: "FINALISED" }, 201);
  });
}
