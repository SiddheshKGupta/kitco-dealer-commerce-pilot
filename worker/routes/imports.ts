import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const schema = z.object({ sourceFileId: z.string().min(1), profileId: z.string().min(1) }).strict();
export function registerImportRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.post("/api/admin/imports", async (context) => {
    const input = await parseBody(context, schema);
    return context.json({ importJob: await repository.stageImport(context.get("session"), input, context.get("correlationId")) }, 201);
  });
}
