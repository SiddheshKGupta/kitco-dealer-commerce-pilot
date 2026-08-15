import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";
import { parseBody } from "./shared";

export interface SizeValueRow { id: string; label: string; sortOrder: number; inUseCount: number }
export interface SizeSetDetailRow { id: string; code: string; name: string; values: SizeValueRow[] }
export interface FamilyOptionRow { id: string; brandId: string; brandName: string; gender: string; name: string }
export interface SizeSetAssignmentRow { brandName: string; gender: string; sizeSetCode: string | null; sizeSetName: string | null; colourwayCount: number }

export interface SizeSetsAdminPayload {
  sizeSets: SizeSetDetailRow[];
  families: FamilyOptionRow[];
  assignments: SizeSetAssignmentRow[];
}

type AssignInput = { sizeSetId: string; familyId: string } | { sizeSetId: string; brandId: string; gender: string };

/** Size sets/values are the shared vocabulary every colourway draws from (v4.0's
 *  size_sets/size_values/product_size_values). "Assign" never rewrites that shared
 *  vocabulary -- it turns on the chosen set's sizes for the target products, additively,
 *  leaving any size an admin already switched off per-product untouched. */
export interface SizeSetsAdmin {
  list(session: SessionIdentity): Promise<SizeSetsAdminPayload>;
  createSet(session: SessionIdentity, code: string, name: string, correlationId: string): Promise<{ id: string }>;
  createValue(session: SessionIdentity, sizeSetId: string, label: string, sortOrder: number, correlationId: string): Promise<{ id: string }>;
  updateValue(session: SessionIdentity, valueId: string, changes: { label?: string; sortOrder?: number }, correlationId: string): Promise<void>;
  removeValue(session: SessionIdentity, valueId: string, correlationId: string): Promise<void>;
  assign(session: SessionIdentity, input: AssignInput, correlationId: string): Promise<{ colourwaysAffected: number }>;
}

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, "Use letters, numbers and underscores only, 2-40 characters");
const nameSchema = z.string().trim().min(2).max(80);
const labelSchema = z.string().trim().min(1).max(10);
const sortOrderSchema = z.number().int().min(0).max(999);

const createSetSchema = z.object({ code: codeSchema, name: nameSchema }).strict();
const createValueSchema = z.object({ label: labelSchema, sortOrder: sortOrderSchema }).strict();
const updateValueSchema = z.object({ label: labelSchema.optional(), sortOrder: sortOrderSchema.optional() }).strict()
  .refine((value) => value.label !== undefined || value.sortOrder !== undefined, "Nothing to update");
const assignSchema = z.union([
  z.object({ sizeSetId: z.string().uuid(), familyId: z.string().uuid() }).strict(),
  z.object({ sizeSetId: z.string().uuid(), brandId: z.string().uuid(), gender: z.string().trim().min(1).max(20) }).strict(),
]);

export function registerSizeSetsAdminRoutes(app: Hono<{ Variables: AuthVariables }>, admin?: SizeSetsAdmin): void {
  if (!admin) return;

  app.get("/api/admin/size-sets", async (context) => context.json(await admin.list(context.get("session"))));

  app.post("/api/admin/size-sets", async (context) => {
    const input = await parseBody(context, createSetSchema);
    const result = await admin.createSet(context.get("session"), input.code, input.name, context.get("correlationId"));
    return context.json(result, 201);
  });

  app.post("/api/admin/size-sets/:id/values", async (context) => {
    const input = await parseBody(context, createValueSchema);
    const result = await admin.createValue(context.get("session"), context.req.param("id"), input.label, input.sortOrder, context.get("correlationId"));
    return context.json(result, 201);
  });

  app.patch("/api/admin/size-sets/values/:valueId", async (context) => {
    const input = await parseBody(context, updateValueSchema);
    await admin.updateValue(context.get("session"), context.req.param("valueId"), input, context.get("correlationId"));
    return context.json({ ok: true });
  });

  app.delete("/api/admin/size-sets/values/:valueId", async (context) => {
    await admin.removeValue(context.get("session"), context.req.param("valueId"), context.get("correlationId"));
    return context.json({ ok: true });
  });

  app.post("/api/admin/size-sets/assign", async (context) => {
    const input = await parseBody(context, assignSchema);
    const result = await admin.assign(context.get("session"), input, context.get("correlationId"));
    return context.json(result);
  });
}
