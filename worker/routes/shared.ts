import type { Context } from "hono";
import type { ZodType } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";

const FORBIDDEN_FIELDS = new Set(["organisationId", "dealerId", "mrpMinor", "retailValueMinor", "dealerPrice", "margin", "gstEstimate", "payableAmount", "stockPairs", "availability"]);

export async function parseBody<T>(context: Context<{ Variables: AuthVariables }>, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try { body = await context.req.json(); } catch { throw new ApiError(400, "INVALID_JSON", "A JSON body is required"); }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const forged = Object.keys(body).find((key) => FORBIDDEN_FIELDS.has(key));
    if (forged) throw new ApiError(400, "UNTRUSTED_COMMERCIAL_FIELD", `Field ${forged} is server-authoritative`);
  }
  return schema.parse(body);
}
